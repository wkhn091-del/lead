import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { Id, LeadParams } from '../leads/leads.schemas.js';
import { ConflictError } from '../stores/types.js';
import { internationalDigits } from './phone.js';
import type { WhatsAppService } from './service.js';

const LinkInput = z.strictObject({
  /** Link with a code typed on the phone instead of scanning a QR code */
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9+()\-.\s]*$/, 'אפשר רק ספרות, רווחים ו-+ ( ) - .')
    .optional(),
});
const VoiceParams = z.object({ id: Id, messageId: Id });

/** Linking and history requests reach WhatsApp, so they are kept to a human pace. */
const whatsappRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, 'יותר מדי בקשות לוואטסאפ. חכו כמה דקות.')),
});

function requireService(service: WhatsAppService | null, off: string) {
  if (!service) throw new HttpError(503, off);
  return service;
}

/** Mounted at /api/whatsapp behind requireAuth: the link's status, linking and unlinking. */
export function createWhatsAppRouter(service: WhatsAppService | null, off: string, countryCode: string) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(service ? service.status() : { enabled: false, reason: off });
  });

  router.post('/link', whatsappRateLimit, async (req, res) => {
    const whatsapp = requireService(service, off);
    const { phone } = LinkInput.parse(req.body ?? {});
    const digits = phone ? internationalDigits(phone, countryCode) : null;
    if (phone && !digits) throw new HttpError(400, 'הזינו את מספר הטלפון של חשבון הוואטסאפ, כמו 054-123-4567.');
    res.json(await whatsapp.link(digits));
  });

  router.post('/reconnect', whatsappRateLimit, async (_req, res) => {
    const whatsapp = requireService(service, off);
    res.json(await whatsapp.reconnect());
  });

  router.post('/unlink', whatsappRateLimit, async (_req, res) => {
    res.json(await requireService(service, off).unlink());
  });

  return router;
}

/** Mounted at /api/leads behind requireAuth: history and voice notes for one lead. */
export function createLeadWhatsAppRouter(service: WhatsAppService | null, off: string) {
  const router = Router();

  router.post('/:id/whatsapp/history', whatsappRateLimit, async (req, res) => {
    const { id } = LeadParams.parse(req.params);
    const result = await requireService(service, off).fetchHistory(id);
    res.status(result.requested ? 202 : 409).json(result);
  });

  router.post('/:id/whatsapp/voice/:messageId', whatsappRateLimit, async (req, res) => {
    const { id, messageId } = VoiceParams.parse(req.params);
    try {
      await requireService(service, off).fetchVoiceNote(id, messageId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new ConflictError(error instanceof Error ? error.message : 'לא הצלחנו להביא את ההודעה הקולית.');
    }
    res.status(202).end();
  });

  return router;
}
