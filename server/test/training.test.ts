import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { STARTER_CARDS, STARTER_KEYS } from '../src/training/starter.js';
import { createApp } from '../src/app.js';
import type { CoachProvider, CoachRequest } from '../src/coach/providers.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createMemoryStores } from '../src/stores/memory.js';
import { freshPractice, type InteractionRecord, type LeadRecord, type ObjectionCardDraft } from '../src/stores/types.js';
import { review } from '../src/training/practice.js';
import { buildTrainingPrompt, cardKey, quoteFound, toDrafts } from '../src/training/prompt.js';
import { buildTailorPrompt, nicheFrom, toVariantDrafts } from '../src/training/tailor.js';
import { TRANSCRIPT_MARKER } from '../src/transcription/pipeline.js';
import { TEST_EMAIL, TEST_PASSWORD } from './credentials.js';

const TZ = 'Asia/Jerusalem';

describe('practice schedule', () => {
  const now = new Date('2026-10-22T07:30:00Z'); // 10:30 in Israel
  // Israel moves its clocks back on 25 October 2026: midnight is +03:00 before and +02:00 after
  const midnight = (day: string) => new Date(`${day}T00:00:00${day < '2026-10-25' ? '+03:00' : '+02:00'}`);

  it('moves cards up a box when answered well, and back to the start when missed', () => {
    let practice = freshPractice(now);
    practice = review(practice, 3, now, TZ);
    expect(practice).toMatchObject({ box: 2, dueAt: midnight('2026-10-23'), reviews: 1, lapses: 0, lastGrade: 3 });
    practice = review(practice, 4, now, TZ);
    expect(practice).toMatchObject({ box: 4, dueAt: midnight('2026-10-29') });
    practice = review(practice, 4, now, TZ);
    expect(practice).toMatchObject({ box: 5, dueAt: midnight('2026-11-05') });
    practice = review(practice, 2, now, TZ);
    expect(practice).toMatchObject({ box: 5, dueAt: midnight('2026-10-29') });
    practice = review(practice, 1, now, TZ);
    expect(practice).toMatchObject({ box: 1, dueAt: now, lapses: 1, reviews: 5 });
  });
});

describe('the starter deck', () => {
  it("claims nothing the studio doesn't offer, and no numbers", () => {
    const words = STARTER_CARDS.flatMap((card) => [card.objection, card.insight, card.response, card.followUp, ...card.alternatives]).join('\n');
    // Payment plans, past clients and their results, "most" as if it were counted
    for (const claim of ['לפרוס', 'תשלומים', 'שבניתי להם', 'ברוב', 'בדרך כלל']) expect(words).not.toContain(claim);
    expect(words).not.toMatch(/(^|\s)רוב\s/);
    expect(words).not.toMatch(/\d/);
    // The studio's real offer is there: the free homepage mockup
    expect(words).toContain('הדמיה של דף הבית');
  });
});

let order = 0;
const at = (iso: string) => new Date(iso);
function entry(leadId: string, overrides: Partial<InteractionRecord>): InteractionRecord {
  order += 1;
  return {
    id: `entry-${order}`,
    leadId,
    kind: 'call',
    outcome: 'answered',
    body: '',
    step: 'answered',
    stage: 'cold_call',
    stageTo: null,
    at: at(`2026-10-${String(10 + order).padStart(2, '0')}T08:00:00Z`),
    source: null,
    chat: [],
    updatedAt: at('2026-10-21T08:00:00Z'),
    ...overrides,
  };
}
function leadRecord(id: string, name: string): LeadRecord {
  return {
    id,
    name,
    contactName: 'Amir',
    phone: '054-123-4567',
    email: 'amir@private.example',
    website: 'secret-site.example',
    campaign: 'Bakeries',
    approach: '',
    method: 'call',
    currency: 'ILS',
    stage: 'cold_call',
    stageChangedAt: at('2026-10-01T08:00:00Z'),
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
    activity: [],
    createdAt: at('2026-10-01T08:00:00Z'),
    updatedAt: at('2026-10-01T08:00:00Z'),
  };
}

describe('building the deck prompt', () => {
  const bakery = leadRecord('lead-a', 'Galilee Bakery');
  const garage = leadRecord('lead-b', 'Kinneret Garage');
  const timelines = new Map<string, InteractionRecord[]>([
    [
      bakery.id,
      [
        entry(bakery.id, { body: `Called Amir.\n\n${TRANSCRIPT_MARKER}\nזה יקר לנו מדי כרגע, אולי אחרי החגים` }),
        entry(bakery.id, { kind: 'note', step: null, outcome: null, body: 'He wants to think about it.' }),
        entry(bakery.id, { kind: 'note', step: null, outcome: null, body: '' }),
      ],
    ],
    [
      garage.id,
      [
        entry(garage.id, {
          kind: 'whatsapp',
          step: null,
          outcome: null,
          source: 'whatsapp',
          body: '09:00 Dudi: יש לי אחיין שבונה אתרים\n09:05 Me: מעולה, מה הוא בנה עד היום?',
        }),
      ],
    ],
  ]);
  const built = buildTrainingPrompt({ leads: [bakery, garage], timelines, existing: [{ key: 'price-too-high', objection: 'זה יקר' }], language: 'auto', businessContext: '', timeZone: TZ });

  it('labels every entry so the AI can cite it, and leaves contact details out', () => {
    expect(built.prompt).toContain('<lead ref="L1" business="Kinneret Garage" campaign="Bakeries" stage="cold call">');
    expect(built.prompt).toContain('type="שיחת וואטסאפ"');
    expect(built.prompt).toContain('- price-too-high: זה יקר');
    expect(built.prompt).not.toMatch(/054-123-4567|private\.example|secret-site/);
    expect(built.stats).toEqual({ leadsAnalyzed: 2, entriesAnalyzed: 3, conversations: 2 });
    expect([...built.refs.keys()].sort()).toEqual(['L1.E1', 'L2.E1', 'L2.E2']);
  });

  it('keeps only quotes that are really in the cited entry', () => {
    expect(quoteFound('זה יקר לנו מדי', built.refs.get('L2.E1')!.text)).toBe(true);
    expect(quoteFound('We already have a website', built.refs.get('L2.E1')!.text)).toBe(false);
    const drafts = toDrafts(
      {
        cards: [
          {
            key: 'Price too high!',
            category: 'price',
            objection: 'זה יקר לנו',
            insight: 'Budget is tight before the holidays.',
            response: 'Totally fair…',
            alternatives: ['a', 'b'],
            followUp: 'What would make it worth it?',
            sources: [
              { entry: 'L2.E1', quote: 'זה יקר לנו מדי כרגע' },
              { entry: 'L9.E9', quote: 'made up' },
              { entry: 'L2.E2', quote: 'invented quote nobody said' },
            ],
          },
          { key: 'diy-nephew', category: 'diy', objection: 'יש לי אחיין', insight: '', response: 'Great…', alternatives: [], followUp: '', sources: [{ entry: 'L1.E1', quote: 'יש לי אחיין שבונה אתרים' }] },
          { key: 'ghost', category: 'other', objection: 'Never said', insight: '', response: '…', alternatives: [], followUp: '', sources: [{ entry: 'L1.E1', quote: 'something else entirely here' }] },
          { key: 'price-too-high', category: 'price', objection: 'Too pricey', insight: '', response: '…', alternatives: [], followUp: '', sources: [{ entry: 'L2.E2', quote: 'He wants to think about it.' }] },
        ],
      },
      built.refs,
    );
    expect(drafts.map((draft) => [draft.key, draft.leadCount, draft.mentions])).toEqual([
      ['price-too-high', 1, 2],
      ['diy-nephew', 1, 1],
    ]);
    expect(drafts[0].sources[0]).toMatchObject({ leadId: 'lead-a', leadName: 'Galilee Bakery', quote: 'זה יקר לנו מדי כרגע' });
    expect(cardKey('יקר', 'price', 'זה יקר')).toMatch(/^price-[0-9a-f]{8}$/);
  });
});

describe('answers tailored to a niche', () => {
  const restaurant: LeadRecord = {
    ...leadRecord('lead-r', 'Golan Steakhouse'),
    campaign: 'מסעדות · גולן',
    stage: 'closed',
    deal: { setupFee: 9_000, monthlyRetainer: 400, hostingYearly: 0 },
  };
  const lawyer: LeadRecord = { ...leadRecord('lead-l', 'Nahum Law'), campaign: 'עורכי דין' };
  const heard = (leadId: string, leadName: string, quote: string) => ({ leadId, leadName, interactionId: `entry-${leadId}`, at: at('2026-10-10T08:00:00Z'), quote });
  const cards = [
    {
      key: 'too-expensive',
      category: 'price' as const,
      objection: 'זה יקר לי.',
      insight: '',
      response: 'Generic answer',
      followUp: 'How much is a customer worth to you?',
      sources: [heard('lead-r', 'Golan Steakhouse', 'הוולט לוקחים לי שלושים אחוז'), heard('lead-l', 'Nahum Law', 'עורך דין לא צריך אתר')],
    },
    { key: 'call-next-month', category: 'timing' as const, objection: 'תתקשר בעוד חודש.', insight: '', response: 'Generic', followUp: '', sources: [] },
  ];

  it('shows the AI how this niche talks, without who said what', () => {
    const { prompt, system, stats } = buildTailorPrompt({ niche: 'מסעדות', cards, leads: [restaurant, lawyer], language: 'he', businessContext: '' });
    expect(prompt).toContain('<niche name="מסעדות" leads="1" cold_call="0" zoom="0" closed="1" not_relevant="0">\nSetup fee of the deal closed in this niche: 9,000 ILS.\n</niche>');
    expect(prompt).toContain('<card key="too-expensive" category="price">\nObjection: זה יקר לי.\nCurrent answer: Generic answer');
    expect(prompt).toContain('Heard from this niche: "הוולט לוקחים לי שלושים אחוז"');
    expect(prompt).not.toContain('עורך דין לא צריך אתר');
    expect(prompt).not.toMatch(/Golan Steakhouse|054-123-4567|private\.example|secret-site/);
    expect(system).toContain('a restaurant: the menu');
    expect(system).toContain('natural, spoken Israeli Hebrew');
    expect(stats).toEqual({ leads: 1, cards: 2 });
  });

  it('keeps one answer per card of the deck', () => {
    const variant = (key: string, response: string) => ({ key, objection: '', insight: 'i', response, alternatives: ['a'], followUp: 'f' });
    const drafts = toVariantDrafts(
      { variants: [variant('too-expensive', 'First'), variant('too-expensive', 'Second'), variant('ghost', 'Not a card'), variant('call-next-month', '')] },
      cards,
    );
    expect(drafts).toEqual([{ cardKey: 'too-expensive', objection: 'זה יקר לי.', insight: 'i', response: 'First', alternatives: ['a'], followUp: 'f' }]);
    expect(nicheFrom('מסעדות · חיפה')).toEqual({ key: 'מסעדות', label: 'מסעדות' });
    expect(nicheFrom(' Law  Firms ')).toEqual({ key: 'law firms', label: 'Law Firms' });
  });
});

describe('objection training API', () => {
  async function setup(coach: CoachProvider | null) {
    const stores = createMemoryStores();
    let now = new Date('2026-10-22T07:00:00Z');
    const app = createApp({ stores, storage: createLocalStorage(tmpdir()), coach }, () => now);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
    return { stores, agent, setNow: (date: Date) => (now = date) };
  }

  const requests: CoachRequest[] = [];
  let answer: unknown;
  /** When set, the stand-in AI answers once it resolves */
  let gate: Promise<void> | null = null;
  const coach: CoachProvider = {
    name: 'anthropic',
    model: 'test-model',
    async complete(request) {
      requests.push(request);
      const reply = answer;
      if (gate) await gate;
      return reply;
    },
  };
  /** Reads a niche's answers until it's no longer being tailored */
  async function finished(agent: ReturnType<typeof request.agent>, niche: string) {
    for (let tries = 0; tries < 200; tries++) {
      const response = await agent.get('/api/training/variants').query({ niche }).expect(200);
      if (!response.body.tailoring) return response.body;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`${niche} was still being tailored`);
  }
  const card = (key: string, quote: string, entryRef = 'L1.E1') => ({
    key,
    category: 'Price',
    objection: `Objection ${key}`,
    insight: 'Why',
    response: 'Say this',
    alternatives: ['Or this', 'Or that'],
    followUp: 'Ask this?',
    sources: [{ entry: entryRef, quote }],
  });

  it('builds the deck from past calls, keeps your practice when refreshed, and schedules reviews', async () => {
    const { agent, setNow } = await setup(coach);
    const lead = { id: randomUUID(), name: 'Galilee Bakery', method: 'call', notes: [{ id: randomUUID(), body: 'He said it costs too much right now and his nephew can do it.', createdAt: new Date().toISOString() }] };
    await agent.post('/api/leads').send(lead).expect(201);

    answer = { cards: [card('price-too-high', 'it costs too much right now'), card('diy-nephew', 'his nephew can do it')] };
    const first = await agent.post('/api/training/generate').send({ language: 'he' }).expect(201);
    expect(requests.at(-1)!.prompt).toContain('He said it costs too much');
    expect(first.body.run).toMatchObject({ leadsAnalyzed: 1, entriesAnalyzed: 1, conversations: 0, cards: 2, language: 'he' });
    const price = first.body.cards.find((item: { key: string }) => item.key === 'price-too-high');
    expect(price).toMatchObject({ category: 'price', leadCount: 1, mentions: 1, myResponse: '', retired: false, practice: { box: 1, reviews: 0 } });

    await agent.patch(`/api/training/cards/${price.id}`).send({ myResponse: 'I hear you — what budget did you have in mind?' }).expect(200);
    const reviewed = await agent.post(`/api/training/cards/${price.id}/review`).send({ grade: 3 }).expect(200);
    expect(reviewed.body.practice).toMatchObject({ box: 2, reviews: 1, lastGrade: 3, dueAt: '2026-10-22T21:00:00.000Z' });
    await agent.post(`/api/training/cards/${price.id}/review`).send({ grade: 7 }).expect(400);

    // A fresh analysis that only finds the price objection again
    setNow(new Date('2026-10-23T07:00:00Z'));
    answer = { cards: [card('price-too-high', 'it costs too much')] };
    const second = await agent.post('/api/training/generate').send({}).expect(201);
    const refreshed = second.body.cards.find((item: { key: string }) => item.key === 'price-too-high');
    expect(refreshed).toMatchObject({ id: price.id, myResponse: 'I hear you — what budget did you have in mind?', practice: { box: 2, reviews: 1 }, retired: false });
    expect(second.body.cards.find((item: { key: string }) => item.key === 'diy-nephew')).toMatchObject({ retired: true });

    const deck = await agent.get('/api/training').expect(200);
    expect(deck.body.run).toMatchObject({ cards: 1 });

    // Practised on the phone without a connection and sent later: the answer keeps its time, and sent twice
    // (the first reply was lost) it counts once
    const practisedAt = '2026-10-23T06:30:00.000Z';
    const offline = await agent.post(`/api/training/cards/${price.id}/review`).send({ grade: 3, at: practisedAt }).expect(200);
    expect(offline.body.practice).toMatchObject({ box: 3, reviews: 2, lastGrade: 3, lastReviewedAt: practisedAt });
    const repeated = await agent.post(`/api/training/cards/${price.id}/review`).send({ grade: 3, at: practisedAt }).expect(200);
    expect(repeated.body.practice).toMatchObject({ box: 3, reviews: 2 });
    await agent.post(`/api/training/cards/${price.id}/review`).send({ grade: 3, at: 'soon' }).expect(400);
  });

  it('starts a new deck with the common objections, and keeps them when the deck is built from calls', async () => {
    const { agent } = await setup(coach);
    // Two first visits at once still make one deck
    const [first] = await Promise.all([agent.get('/api/training').expect(200), agent.get('/api/training').expect(200)]);
    expect(first.body.run).toMatchObject({ provider: 'starter', cards: STARTER_CARDS.length, leadsAnalyzed: 0 });
    expect(first.body.cards.map((item: { key: string }) => item.key)).toEqual(STARTER_KEYS);
    expect(first.body.cards[0]).toMatchObject({ objection: 'יש לי כבר אתר.', leadCount: 0, sources: [], retired: false, practice: { box: 1 } });
    const again = await agent.get('/api/training').expect(200);
    expect(again.body.cards).toHaveLength(STARTER_CARDS.length);

    // Practise one, then build the deck from a call that raised a common objection and a new one
    const expensive = first.body.cards.find((item: { key: string }) => item.key === 'too-expensive');
    const social = first.body.cards.find((item: { key: string }) => item.key === 'social-is-enough');
    await agent.post(`/api/training/cards/${social.id}/review`).send({ grade: 4 }).expect(200);
    await agent.post('/api/leads').send({ id: randomUUID(), name: 'Galilee Bakery', method: 'call', notes: [{ id: randomUUID(), body: 'He said it costs too much right now and his nephew can do it.', createdAt: new Date().toISOString() }] }).expect(201);
    answer = { cards: [card('too-expensive', 'it costs too much right now'), card('diy-nephew', 'his nephew can do it')] };
    const built = await agent.post('/api/training/generate').send({}).expect(201);
    // The AI sees the deck's keys, so it can reuse them
    expect(requests.at(-1)!.prompt).toContain('too-expensive');
    expect(built.body.run).toMatchObject({ provider: 'anthropic', cards: 2 });
    const cards: { id: string; key: string; leadCount: number; retired: boolean; practice: { box: number } }[] = built.body.cards;
    expect(cards).toHaveLength(STARTER_CARDS.length + 1);
    expect(cards.slice(0, 2).map((item) => item.key).sort()).toEqual(['diy-nephew', 'too-expensive']);
    expect(cards.find((item) => item.key === 'too-expensive')).toMatchObject({ id: expensive.id, leadCount: 1 });
    expect(cards.every((item) => !item.retired)).toBe(true);
    expect(cards.find((item) => item.key === 'social-is-enough')).toMatchObject({ id: social.id, leadCount: 0, practice: { box: 3 } });
    // The common ones follow in their usual order
    expect(cards.slice(2).map((item) => item.key)).toEqual(STARTER_KEYS.filter((key) => key !== 'too-expensive'));
  });

  it('gives a saved deck the common objections in their current words, keeping your practice', async () => {
    const stores = createMemoryStores();
    const now = new Date('2026-10-22T07:00:00Z');
    const starter = (key: string) => STARTER_CARDS.find((item) => item.key === key)!;
    const draft = (key: string, change: Partial<ObjectionCardDraft> = {}): ObjectionCardDraft => ({
      ...starter(key),
      alternatives: [...starter(key).alternatives],
      leadCount: 0,
      mentions: 0,
      sources: [],
      ...change,
    });
    // Saved by an earlier version: a common card in older words, one your prospects raised, one already current
    const quote = { leadId: 'lead-1', leadName: 'Arbel', interactionId: 'entry-1', at: now, quote: 'כבר יש לי אתר' };
    await stores.training.saveRun(
      [
        draft('already-have-website', { response: 'An answer the AI wrote from your calls', leadCount: 1, mentions: 1, sources: [quote] }),
        draft('too-expensive', { response: 'מבין. כמה שווה לך לקוח חדש אחד? ואפשר גם לפרוס את התשלום.' }),
        draft('call-next-month'),
      ],
      { provider: 'starter', model: 'starter', language: 'he', leadsAnalyzed: 0, entriesAnalyzed: 0, conversations: 0, cards: 3 },
      now,
    );
    const expensive = (await stores.training.cards()).find((item) => item.key === 'too-expensive')!;
    await stores.training.updateCard(expensive.id, { myResponse: 'My own answer', practice: { ...expensive.practice, box: 3, reviews: 2 } });
    const variant = (cardKey: string, response: string) => ({ cardKey, objection: 'o', insight: 'i', response, alternatives: [], followUp: 'f' });
    await stores.training.saveVariants(
      { key: 'מסעדות', label: 'מסעדות' },
      [variant('too-expensive', 'Written from the old words'), variant('call-next-month', 'Still current')],
      { provider: 'anthropic', model: 'test-model' },
    );

    let rewordings = 0;
    const reword = stores.training.rewordCommon.bind(stores.training);
    stores.training.rewordCommon = (cards) => {
      rewordings += 1;
      return reword(cards);
    };
    const agent = request.agent(createApp({ stores, storage: createLocalStorage(tmpdir()), coach }, () => now));
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);

    const deck = await agent.get('/api/training').expect(200);
    const byKey = (key: string) => deck.body.cards.find((item: { key: string }) => item.key === key);
    expect(byKey('too-expensive')).toMatchObject({
      id: expensive.id,
      response: starter('too-expensive').response,
      myResponse: 'My own answer',
      practice: { box: 3, reviews: 2 },
    });
    // A card your prospects raised keeps the words the AI wrote from your calls
    expect(byKey('already-have-website')).toMatchObject({ response: 'An answer the AI wrote from your calls', leadCount: 1 });
    // Tailored answers written from the old words go; the rest stay
    const tailored = await agent.get('/api/training/variants').query({ niche: 'מסעדות' }).expect(200);
    expect(tailored.body.variants.map((item: { cardKey: string }) => item.cardKey)).toEqual(['call-next-month']);
    await agent.get('/api/training').expect(200);
    expect(rewordings).toBe(1);
  });

  it('tailors the deck to a niche in the background, and lists the niches', async () => {
    const { agent } = await setup(coach);
    for (const [name, campaign] of [['Golan Steakhouse', 'מסעדות · גולן'], ['Kinneret Fish House', 'מסעדות'], ['Nahum Law', 'עורכי דין']]) {
      await agent.post('/api/leads').send({ id: randomUUID(), name, method: 'call', campaign }).expect(201);
    }
    const niches = await agent.get('/api/training/niches').expect(200);
    expect(niches.body).toEqual({
      niches: [
        { key: 'מסעדות', label: 'מסעדות', leads: 2, tailored: null },
        { key: 'עורכי דין', label: 'עורכי דין', leads: 1, tailored: null },
      ],
      tailoring: [],
    });

    // The answer arrives when the gate opens, so the request is seen while it's still being written
    let open = () => {};
    gate = new Promise<void>((resolve) => (open = resolve));
    const variant = (key: string, response: string) => ({ key, objection: `${key} (מסעדה)`, insight: 'Why', response, alternatives: ['a', 'b', 'c', 'd'], followUp: 'Ask?' });
    answer = { variants: [variant('too-expensive', 'כמה עולה לך כל הזמנה דרך אפליקציות המשלוחים?'), variant('not-a-card', 'Dropped'), variant('too-expensive', 'Duplicate')] };
    const before = requests.length;
    const started = await agent.post('/api/training/variants').send({ niche: 'מסעדות · חיפה', language: 'he' }).expect(202);
    expect(started.body).toMatchObject({ niche: { key: 'מסעדות', label: 'מסעדות' }, variants: [], tailoring: true, error: null });
    await agent.post('/api/training/variants').send({ niche: 'מסעדות' }).expect(202);
    expect((await agent.get('/api/training/niches').expect(200)).body.tailoring).toEqual(['מסעדות']);
    open();
    const done = await finished(agent, 'מסעדות');
    expect(requests.length).toBe(before + 1);
    expect(requests.at(-1)!.prompt).toContain('<niche name="מסעדות" leads="2" cold_call="2" zoom="0" closed="0" not_relevant="0"></niche>');
    expect(requests.at(-1)!.prompt).toContain('<card key="already-have-website" category="need">');
    expect(done).toMatchObject({ tailoring: false, error: null, provider: 'anthropic', model: 'test-model' });
    expect(done.variants).toEqual([
      { cardKey: 'too-expensive', objection: 'too-expensive (מסעדה)', insight: 'Why', response: 'כמה עולה לך כל הזמנה דרך אפליקציות המשלוחים?', alternatives: ['a', 'b', 'c'], followUp: 'Ask?' },
    ]);
    const listed = await agent.get('/api/training/niches').expect(200);
    expect(listed.body.niches[0]).toMatchObject({ key: 'מסעדות', leads: 2, tailored: { cards: 1 } });

    // Tailoring again replaces the niche's answers
    answer = { variants: [variant('call-next-month', 'בשישי אתה בטח עמוס. מתי נוח לך באמצע השבוע?')] };
    await agent.post('/api/training/variants').send({ niche: 'מסעדות' }).expect(202);
    expect((await finished(agent, 'מסעדות')).variants.map((item: { cardKey: string }) => item.cardKey)).toEqual(['call-next-month']);

    // A failed attempt is reported once
    answer = { variants: [] };
    await agent.post('/api/training/variants').send({ niche: 'עורכי דין' }).expect(202);
    expect((await finished(agent, 'עורכי דין')).error).toBe('ה-AI לא החזיר תשובות מותאמות. נסו שוב.');
    expect((await agent.get('/api/training/variants').query({ niche: 'עורכי דין' }).expect(200)).body).toMatchObject({ error: null, variants: [] });

    await agent.get('/api/training/variants').query({ niche: 'x' }).expect(400);
    await (await setup(null)).agent.post('/api/training/variants').send({ niche: 'מסעדות' }).expect(503);
  });

  it('refuses invented quotes, explains when there is nothing to learn from, and needs the AI coach', async () => {
    const { agent } = await setup(coach);
    await agent.post('/api/training/generate').send({}).expect(409);
    await agent.post('/api/leads').send({ id: randomUUID(), name: 'Arbel', method: 'call', notes: [{ id: randomUUID(), body: 'Busy until after the holidays.', createdAt: new Date().toISOString() }] }).expect(201);
    answer = { cards: [card('made-up', 'We already have a beautiful website')] };
    await agent.post('/api/training/generate').send({}).expect(502);

    const off = await setup(null);
    await off.agent.post('/api/training/generate').send({}).expect(503);
  });
});
