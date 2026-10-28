import { z } from 'zod';

export const DEAL_HEALTH = ['won', 'hot', 'warm', 'cold', 'stalled', 'lost'] as const;
export const LIKELIHOOD = ['high', 'medium', 'low'] as const;

const text = (description: string) => ({ type: 'string', description });
const list = (description: string) => ({ type: 'array', description, items: { type: 'string' } });
const whole = (description: string) => ({ type: 'integer', description });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/**
 * The shape the AI must answer in. It works with every provider's structured outputs:
 * every field required, no extra fields, and no length or range limits (Anthropic doesn't accept them).
 */
export const ANALYSIS_JSON_SCHEMA = object({
  summary: text('Two or three sentences: where this deal stands now and why.'),
  dealHealth: {
    type: 'string',
    enum: [...DEAL_HEALTH],
    description: 'won: deal closed. hot: likely to close soon. warm: interested, open questions. cold: little interest so far. stalled: momentum lost. lost: not relevant or said no.',
  },
  actionPlan: {
    type: 'array',
    description: 'The plan from today to the next commitment (Cold Call: a booked Zoom; Zoom Meeting: a signed deal; Deal Closed: delivery and the upsell). 3 to 6 steps, in the order to do them.',
    items: object({
      step: text('One concrete action, specific to this deal.'),
      when: text('When to do it: "today", "tomorrow morning", "the evening before the Zoom", "within two days"…'),
      why: text('What it moves forward, in one short clause.'),
    }),
  },
  pricing: object({
    setupFee: whole('The one-time price to quote for building the site, in the deal currency.'),
    monthlyRetainer: whole('The monthly price to propose for maintenance and management, in the deal currency; 0 when not worth proposing to this client.'),
    hostingYearly: whole('The yearly price for domain and hosting, in the deal currency; 0 when the client keeps their own.'),
    walkAwaySetupFee: whole('The lowest setup fee worth accepting. Below it, the seller should cut scope rather than price.'),
    scope: list('What the package includes at this price: pages, features, content work. 3 to 6 short items.'),
    rationale: text('Why this price: the seller’s past deals in <price_history>, the size and needs of this business, anything said about budget. Say plainly when there is little to go on.'),
    howToPresent: text('The exact words to present the price on the call: natural spoken sentences, anchored on what it brings the client.'),
  }),
  closingObjections: {
    type: 'array',
    description: 'What this prospect is likely to raise when asked to commit, most likely first. 2 to 4, counting any still open in the timeline.',
    items: object({
      objection: text('The objection the way this prospect would say it.'),
      likelihood: { type: 'string', enum: [...LIKELIHOOD] },
      why: text('What in the timeline or the business makes it likely.'),
      response: text('Exact words to answer it: short, natural, spoken.'),
    }),
  },
  wentWell: list('What the seller did well, each tied to a specific moment in the timeline.'),
  wentWrong: list('Where the deal lost ground, each tied to a specific moment in the timeline.'),
  mistakes: {
    type: 'array',
    description: "The seller's own mistakes: what they said, didn't ask, or didn't do.",
    items: object({
      mistake: text('The mistake, in one sentence.'),
      evidence: text('The entry and the words in the notes that show it.'),
      fix: text('What to say or do instead, concretely.'),
    }),
  },
  objections: {
    type: 'array',
    description: 'Every objection or hesitation the prospect raised.',
    items: object({
      objection: text('The objection, in the prospect’s terms.'),
      status: { type: 'string', enum: ['resolved', 'open'] },
      response: text('Exact words the seller can use to answer it.'),
    }),
  },
  openQuestions: list('What the seller still needs to find out (decision maker, budget, timing, current website…).'),
  tips: list('Concrete next actions for this deal. No generic sales advice.'),
  nextCall: object({
    goal: text('The one outcome the next call must get.'),
    timing: text('When to call next and why.'),
    inDays: whole('Whole days from today until that next contact: 0 for today, 1 for tomorrow, at most 60.'),
    script: {
      type: 'array',
      description: 'The next call, step by step, in the exact words to say.',
      items: object({
        step: text('A short label, like "Opener" or "Answer the price objection".'),
        say: text('The exact words to say: natural spoken sentences.'),
      }),
    },
    fallbackMessage: text('A short WhatsApp message to send if they don’t pick up.'),
  }),
});

/** Enum values can come back capitalized differently ("Stalled"), so they are compared in lowercase. */
const lowercase = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim().toLowerCase() : value), z.enum(values));

/** A whole amount the deal fields accept: no fractions, nothing below zero, at most 8 digits */
const amount = z.number().transform((value) => Math.min(99_999_999, Math.max(0, Math.round(value))));
const lines = z.array(z.string().trim()).transform((items) => items.filter(Boolean));

const Pricing = z
  .object({
    setupFee: amount,
    monthlyRetainer: amount,
    hostingYearly: amount,
    walkAwaySetupFee: amount,
    scope: lines.transform((items) => items.slice(0, 8)),
    rationale: z.string().trim(),
    howToPresent: z.string().trim(),
  })
  // A floor above the price itself means the AI mixed them up
  .transform((pricing) => ({ ...pricing, walkAwaySetupFee: Math.min(pricing.walkAwaySetupFee, pricing.setupFee) }));

/**
 * Checks the AI's answer before it is saved; extra fields are dropped. The parts added later (the plan, the
 * price and the closing objections) fall back to empty rather than failing the whole analysis.
 */
export const Analysis = z.object({
  summary: z.string(),
  dealHealth: lowercase(DEAL_HEALTH),
  actionPlan: z
    .array(z.object({ step: z.string().trim().min(1), when: z.string().trim(), why: z.string().trim() }))
    .transform((steps) => steps.slice(0, 8))
    .catch([]),
  pricing: Pricing.nullable().catch(null),
  closingObjections: z
    .array(z.object({ objection: z.string().trim().min(1), likelihood: lowercase(LIKELIHOOD).catch('medium'), why: z.string().trim(), response: z.string().trim() }))
    .transform((items) => items.slice(0, 6))
    .catch([]),
  wentWell: z.array(z.string()),
  wentWrong: z.array(z.string()),
  mistakes: z.array(z.object({ mistake: z.string(), evidence: z.string(), fix: z.string() })),
  objections: z.array(z.object({ objection: z.string(), status: lowercase(['resolved', 'open'] as const), response: z.string() })),
  openQuestions: z.array(z.string()),
  tips: z.array(z.string()),
  nextCall: z.object({
    goal: z.string(),
    timing: z.string(),
    inDays: z
      .number()
      .transform((days) => Math.min(60, Math.max(0, Math.round(days))))
      .nullable()
      .catch(null),
    script: z.array(z.object({ step: z.string(), say: z.string() })),
    fallbackMessage: z.string(),
  }),
});

export type Analysis = z.infer<typeof Analysis>;

/**
 * What is stored: the price in the deal's currency at the time, and how many of your closed deals (in that
 * currency, with amounts) it was anchored on; 0 means the AI's general estimate. Reports saved before it was
 * recorded have no basedOnDeals.
 */
export type StoredAnalysis = Omit<Analysis, 'pricing'> & {
  pricing: (NonNullable<Analysis['pricing']> & { currency: 'ILS' | 'USD'; basedOnDeals: number }) | null;
};
