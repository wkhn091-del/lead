import { Router } from 'express';
import { HttpError } from '../lib/http-error.js';
import { InteractionInput, InteractionParams, InteractionPatch, LeadParams } from '../leads/leads.schemas.js';
import { publicMedia } from '../media/media.routes.js';
import { ConflictError, type InteractionRecord, type Stores } from '../stores/types.js';

const leadNotFound = () => new HttpError(404, 'הליד הזה כבר לא קיים.');
const entryNotFound = () => new HttpError(404, 'הרשומה הזו כבר לא קיימת בציר הזמן.');
const mirrored = () =>
  new ConflictError('השיחה הזו משוקפת מוואטסאפ ונשארת כמו שהיא שם. כדי להגיב עליה, הוסיפו הערה.');

/**
 * A timeline entry as the API returns it. What's needed to download a voice note again stays on the
 * server; the app only learns whether it can ask for one.
 */
export function publicInteraction({ chat, ...entry }: InteractionRecord) {
  return {
    ...entry,
    chat: chat.map(({ ref, ...line }) => ({ ...line, canFetch: line.type === 'voice' && !line.mediaId && !line.deleted && ref !== null })),
  };
}

/**
 * Mounted at /api/leads behind requireAuth. The lead profile: its timeline, recordings and latest coaching report.
 * Calls and Zoom meetings are logged through workflow actions (leads.routes.ts); notes and messages come in here.
 */
export function createTimelineRouter(stores: Stores, clock: () => Date) {
  const router = Router();

  router.get('/:id/timeline', async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    if (!(await stores.leads.get(id))) throw leadNotFound();
    const [interactions, media, coaching] = await Promise.all([
      stores.interactions.list(id),
      stores.media.list(id),
      stores.coaching.latest(id),
    ]);
    res.json({ interactions: interactions.map(publicInteraction), media: media.map(publicMedia), coaching });
  });

  /** A note, WhatsApp message or email. Idempotent: the same id twice creates one entry. */
  router.post('/:id/interactions', async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    const input = InteractionInput.parse(req.body);
    // "wa-…" ids belong to mirrored WhatsApp conversations
    if (input.id.startsWith('wa-')) throw new HttpError(400, 'מזהה של רשומה לא יכול להתחיל ב-"wa-".');
    const lead = await stores.leads.get(id);
    if (!lead) throw leadNotFound();
    const entry = await stores.interactions.create({
      id: input.id,
      leadId: id,
      kind: input.kind,
      outcome: null,
      body: input.body,
      step: null,
      stage: lead.stage,
      stageTo: null,
      at: input.at ? new Date(input.at) : clock(),
    });
    res.status(201).json(publicInteraction(entry));
  });

  /** Edits the notes or transcript of any entry, calls and meetings included. */
  router.patch('/:id/interactions/:interactionId', async (req, res) => {
    const { id, interactionId } = InteractionParams.parse(req.params);
    const { body, expectedUpdatedAt } = InteractionPatch.parse(req.body);
    if ((await stores.interactions.get(id, interactionId))?.source === 'whatsapp') throw mirrored();
    const entry = await stores.interactions.update(
      id,
      interactionId,
      { body },
      expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined,
    );
    if (!entry) throw entryNotFound();
    res.json(publicInteraction(entry));
  });

  /** Notes and messages can be deleted. Their recordings stay on the lead. */
  router.delete('/:id/interactions/:interactionId', async (req, res) => {
    const { id, interactionId } = InteractionParams.parse(req.params);
    const entry = await stores.interactions.get(id, interactionId);
    if (entry?.source === 'whatsapp') throw mirrored();
    if (entry?.step) {
      throw new ConflictError('הרשומה הזו מתעדת צעד במשפך. אפשר לבטל את הצעד תוך 10 דקות, או למחוק את הסיכום שלה.');
    }
    if (entry) {
      await stores.media.detach(interactionId);
      await stores.interactions.remove(id, interactionId);
    }
    res.status(204).end();
  });

  return router;
}
