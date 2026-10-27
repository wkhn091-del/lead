import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../lib/http-error.js';
import { CoachingInput, LeadParams } from '../leads/leads.schemas.js';
import { ConflictError, type Stores } from '../stores/types.js';
import { priceHistory } from './pricing.js';
import { buildCoachingPrompt } from './prompt.js';
import type { CoachProvider } from './providers.js';
import { ANALYSIS_JSON_SCHEMA, Analysis, type StoredAnalysis } from './schema.js';

export interface CoachSettings {
  timeZone: string;
  businessContext: string;
}

/** Each analysis costs money, so a runaway script or a stuck button can't run up a bill. */
const coachRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'הגעתם ל-40 ניתוחים בשעה. נסו שוב קצת יותר מאוחר.')),
});

/**
 * Mounted at /api/leads behind requireAuth: POST /:id/coaching runs the AI coach and saves its report. The
 * report is the deal analysis: where it stands, a plan of action, a recommended price (anchored on the seller's
 * other closed deals), the objections to expect when asking to close, and the script for the next call.
 */
export function createCoachRouter(stores: Stores, coach: CoachProvider | null, settings: CoachSettings, clock: () => Date) {
  const router = Router();
  const running = new Set<string>();

  router.post('/:id/coaching', coachRateLimit, async (req, res) => {
    if (!coach) {
      throw new HttpError(503, 'מאמן ה-AI כבוי. הגדירו AI_PROVIDER ו-AI_API_KEY בשרת כדי להפעיל אותו (בחינם: \u2066AI_PROVIDER=gemini\u2069 עם מפתח מ-\u2066Google AI Studio\u2069).');
    }
    const { id } = LeadParams.parse(req.params);
    const { language } = CoachingInput.parse(req.body ?? {});
    if (running.has(id)) throw new ConflictError('ניתוח של הליד הזה כבר רץ.');

    running.add(id);
    try {
      const lead = await stores.leads.get(id);
      if (!lead) throw new HttpError(404, 'הליד הזה כבר לא קיים.');
      const [interactions, media, leads] = await Promise.all([stores.interactions.list(id), stores.media.list(id), stores.leads.list()]);
      const prices = priceHistory(leads, lead);

      // Only the lead's name, contact name, campaign, stage, approach notes and timeline go to the AI, with the
      // amounts (not the names) of other closed deals. Phone numbers, emails and websites stay on this server.
      const { system, prompt } = buildCoachingPrompt({
        lead,
        interactions,
        media,
        now: clock(),
        timeZone: settings.timeZone,
        language,
        businessContext: settings.businessContext,
        prices,
      });
      const answer = await coach.complete({ system, prompt, schema: ANALYSIS_JSON_SCHEMA, maxTokens: 10_000 });
      const parsed = Analysis.safeParse(answer);
      if (!parsed.success) {
        console.error('The AI answer did not match the analysis schema:', parsed.error.issues.slice(0, 5));
        throw new HttpError(502, 'ה-AI ענה בפורמט לא צפוי. נסו שוב.');
      }
      // The price is in the currency the deal had when it was analyzed, and says what it's based on: your closed
      // deals in that currency, or none (the AI's general estimate), so the app can tell the two apart
      const analysis: StoredAnalysis = {
        ...parsed.data,
        pricing: parsed.data.pricing && { ...parsed.data.pricing, currency: lead.currency, basedOnDeals: prices.priced },
      };

      const report = await stores.coaching.create({
        leadId: id,
        provider: coach.name,
        model: coach.model,
        interactionCount: interactions.length,
        analysis,
      });
      res.status(201).json(report);
    } finally {
      running.delete(id);
    }
  });

  return router;
}
