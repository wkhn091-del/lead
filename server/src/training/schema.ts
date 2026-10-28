import { z } from 'zod';
import { OBJECTION_CATEGORIES } from '../stores/types.js';

const text = (description: string) => ({ type: 'string', description });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** The most cards one analysis keeps: enough for a deck, few enough to practise */
export const MAX_CARDS = 12;

/**
 * The deck the AI must answer with. Same rules as the coach's schema: every field required, no extra
 * fields, no length limits, so it works with both providers' structured outputs.
 */
export const DECK_JSON_SCHEMA = object({
  cards: {
    type: 'array',
    description: `The objections prospects raised most, most leads first. At most ${MAX_CARDS}.`,
    items: object({
      key: text('A short id in English, lowercase words joined by dashes, like "price-too-high". Reuse the key of an existing card for the same objection.'),
      category: {
        type: 'string',
        enum: [...OBJECTION_CATEGORIES],
        description:
          'price: cost or budget. timing: not now, busy season, call later. trust: unsure about the seller or results. need: happy with what they have, sees no value. authority: someone else decides. competition: already talking to or working with someone. diy: will do it themselves or a relative will. other.',
      },
      objection: text('The objection the way prospects say it, in the language they used. One short sentence.'),
      insight: text('What usually sits behind it, judging by what these prospects said. One or two sentences.'),
      response: text('The answer to practise: what the seller says out loud, in natural spoken sentences, under 60 words. Fit it to the seller’s offer.'),
      alternatives: { type: 'array', description: 'Two other good ways to answer, one or two sentences each.', items: { type: 'string' } },
      followUp: text('One question to ask right after the answer, to keep the conversation moving.'),
      sources: {
        type: 'array',
        description: 'Every entry where a prospect raised it.',
        items: object({
          entry: text('The entry’s ref, like "L3.E2".'),
          quote: text('The prospect’s words, copied exactly from that entry.'),
        }),
      },
    }),
  },
});

/** Enum values sometimes come back capitalized, so they are compared in lowercase. */
const Category = z.preprocess((value) => (typeof value === 'string' ? value.trim().toLowerCase() : value), z.enum(OBJECTION_CATEGORIES)).catch('other');

/** Checks the AI's answer before anything is saved; extra fields are dropped. */
export const Deck = z.object({
  cards: z.array(
    z.object({
      key: z.string(),
      category: Category,
      objection: z.string().trim().min(1),
      insight: z.string().trim(),
      response: z.string().trim().min(1),
      alternatives: z.array(z.string().trim()).transform((items) => items.filter(Boolean).slice(0, 3)),
      followUp: z.string().trim(),
      sources: z.array(z.object({ entry: z.string().trim(), quote: z.string().trim() })),
    }),
  ),
});

export type Deck = z.infer<typeof Deck>;
