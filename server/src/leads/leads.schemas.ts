import { z } from 'zod';
import { ACTION_TYPES, STAGES } from './workflow.js';

// These mirror src/types.ts in the frontend. Unknown fields are rejected.

export const CONTACT_METHODS = ['call', 'whatsapp'] as const;
export const CURRENCIES = ['ILS', 'USD'] as const;

/** Most leads one bulk request may create or delete. The frontend sends bigger imports in batches. */
export const BULK_LIMIT = 500;

/** Client-generated ids: UUIDs, or the frontend's "sample-…" ids */
export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'אפשר רק אותיות באנגלית, ספרות, - או _');

const EmailFormat = z.email();
/** A domain or an http(s) address. Anything else (javascript:, mailto:) is refused, since it becomes a link. */
const WEBSITE = /^(https?:\/\/)?[^\s/?#:@]+\.[^\s/?#:@]{2,}(:\d{1,5})?([/?#]\S*)?$/i;

const Timestamp = z.iso.datetime({ offset: true });
const Name = z.string().trim().min(1, 'חובה למלא שם').max(120);
const ContactName = z.string().trim().max(120);
const Phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9+()\-.\s]*$/, 'אפשר רק ספרות, רווחים ו-+ ( ) - .');
const Email = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === '' || EmailFormat.safeParse(value).success, 'צריך כתובת אימייל תקינה');
const Website = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || WEBSITE.test(value), 'צריך כתובת אתר, כמו business.co.il');
const Campaign = z.string().trim().max(60);
const Approach = z.string().trim().max(2000);
/** Whole units of the lead's currency */
const Amount = z.number().int().min(0).max(99_999_999);
const Method = z.enum(CONTACT_METHODS);
const Currency = z.enum(CURRENCIES);

export const NoteInput = z.strictObject({
  id: Id,
  body: z.string().trim().min(1, 'ההערה ריקה').max(5000),
  createdAt: Timestamp,
});

/** A closed deal's amounts: the build, the monthly retainer, and the yearly domain and hosting renewal */
export const DealTerms = z.strictObject({
  setupFee: Amount,
  monthlyRetainer: Amount,
  hostingYearly: Amount,
});

const NOT_CLOSED_YET = 'אפשר להוסיף את סכומי העסקה רק אחרי שהעסקה נסגרה';
const NoDeal = z.strictObject({
  setupFee: z.literal(0, NOT_CLOSED_YET),
  monthlyRetainer: z.literal(0, NOT_CLOSED_YET),
  hostingYearly: z.literal(0, NOT_CLOSED_YET),
});

/**
 * A new lead. It always starts at Cold Call with no calls and no deal amounts; the workflow fields are
 * accepted only with those starting values, so whole lead objects can be sent as they are.
 */
export const LeadInput = z.strictObject({
  id: Id,
  name: Name,
  contactName: ContactName.default(''),
  phone: Phone.default(''),
  email: Email.default(''),
  website: Website.default(''),
  campaign: Campaign.default(''),
  approach: Approach.default(''),
  method: Method,
  currency: Currency.default('ILS'),
  notes: z.array(NoteInput).max(500).default([]),
  createdAt: Timestamp.optional(),
  updatedAt: Timestamp.optional(),
  stage: z.literal('cold_call', 'לידים חדשים מתחילים בשלב שיחה קרה').optional(),
  stageChangedAt: Timestamp.optional(),
  archivedAt: z.null().optional(),
  attemptCount: z.literal(0).optional(),
  lastAttemptAt: z.null().optional(),
  deal: NoDeal.optional(),
  /** Sent by apps from before deal terms, always 0 */
  value: z.literal(0, NOT_CLOSED_YET).optional(),
  activity: z.tuple([]).optional(),
});

/**
 * Editable details. The stage changes only through actions; the deal's amounts (any of the three) and its
 * currency only on a closed deal.
 */
export const LeadPatch = z
  .strictObject({
    name: Name,
    contactName: ContactName,
    phone: Phone,
    email: Email,
    website: Website,
    campaign: Campaign,
    approach: Approach,
    method: Method,
    deal: DealTerms.partial().refine((deal) => Object.keys(deal).length > 0, 'צריך לפחות סכום אחד לשינוי.'),
    currency: Currency,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'צריך לשלוח לפחות שדה אחד לשינוי.');

/** Notes and transcripts: long enough for a few hours of conversation */
export const BODY_LIMIT = 400_000;
const Body = z.string().trim().max(BODY_LIMIT, `עד ${BODY_LIMIT.toLocaleString('en-US')} תווים.`);

export const ActionInput = z.strictObject({
  id: Id,
  type: z.enum(ACTION_TYPES),
  from: z.enum(STAGES),
  /** What was said, stored on the timeline entry the step creates */
  body: Body.default(''),
  /** How the conversation happened. By default a phone call at Cold Call and a Zoom meeting at Zoom Meeting. */
  channel: z.enum(['call', 'zoom']).optional(),
  /**
   * When it happened, for a step logged on a phone without a connection and sent once it was back. Kept within
   * the last week, and never before the lead's latest step or after now (see stepTime).
   */
  at: Timestamp.optional(),
});

/** Timeline entries that don't move the lead. Calls and Zoom meetings are logged through actions. */
export const InteractionInput = z.strictObject({
  id: Id,
  kind: z.enum(['note', 'whatsapp', 'email']),
  body: Body.min(1, 'צריך לכתוב משהו קודם.'),
  at: Timestamp.optional(),
});

export const InteractionPatch = z.strictObject({
  body: Body,
  /** When the text being replaced was read. A newer entry (a transcript just arrived) gets a 409 instead of being overwritten. */
  expectedUpdatedAt: Timestamp.optional(),
});
export const InteractionParams = z.object({ id: Id, interactionId: Id });
export const MediaParams = z.object({ mediaId: Id });
/** The text fields sent with an upload */
export const MediaFields = z.object({ interactionId: Id.optional() });

export const COACH_LANGUAGES = ['auto', 'he', 'en'] as const;
export const CoachingInput = z.strictObject({
  /** auto writes in the language of the notes */
  language: z.enum(COACH_LANGUAGES).default('auto'),
});

export const BulkCreateBody = z.strictObject({
  leads: z.array(LeadInput).min(1, 'צריך לשלוח לפחות ליד אחד.').max(BULK_LIMIT, `אפשר לשלוח עד ${BULK_LIMIT} לידים בבקשה אחת.`),
});

export const BulkDeleteBody = z.strictObject({
  ids: z.array(Id).min(1).max(BULK_LIMIT),
});

export const LeadParams = z.object({ id: Id });
export const ActionParams = z.object({ id: Id, actionId: Id });

export type LeadInput = z.infer<typeof LeadInput>;
export type LeadPatch = z.infer<typeof LeadPatch>;
export type NoteInput = z.infer<typeof NoteInput>;
