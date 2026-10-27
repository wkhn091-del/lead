import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describePriceHistory, priceHistory } from '../src/coach/pricing.js';
import { buildCoachingPrompt, describeEntries } from '../src/coach/prompt.js';
import { createCoachProvider, DEFAULT_MODELS } from '../src/coach/providers.js';
import { ANALYSIS_JSON_SCHEMA, Analysis } from '../src/coach/schema.js';
import type { InteractionRecord, LeadRecord } from '../src/stores/types.js';
import { sampleAnalysis } from './fixtures.js';

const at = (iso: string) => new Date(iso);
let order = 0;
function entry(overrides: Partial<InteractionRecord>): InteractionRecord {
  order += 1;
  return {
    id: `entry-${order}`,
    leadId: 'lead-1',
    kind: 'call',
    outcome: 'no_answer',
    body: '',
    step: 'no_answer',
    stage: 'cold_call',
    stageTo: null,
    at: at(`2026-10-0${order}T08:00:00Z`),
    source: null,
    chat: [],
    updatedAt: at('2026-10-10T08:00:00Z'),
    ...overrides,
  };
}

const lead: LeadRecord = {
  id: 'lead-1',
  name: 'Arbel Olive Press',
  contactName: 'Moshe Azulay',
  phone: '050-000-0142',
  email: 'moshe@arbel.example',
  website: 'arbel-olive.example',
  campaign: 'Food producers',
  approach: 'Lead with the free homepage mockup.',
  method: 'call',
  currency: 'ILS',
  stage: 'zoom',
  stageChangedAt: at('2026-10-02T08:00:00Z'),
  archivedAt: null,
  attemptCount: 1,
  lastAttemptAt: at('2026-10-02T08:00:00Z'),
  deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
  activity: [],
  createdAt: at('2026-09-28T08:00:00Z'),
  updatedAt: at('2026-10-02T08:00:00Z'),
};

describe('coaching prompt', () => {
  const history = [
    entry({}),
    entry({ outcome: 'answered', step: 'advanced', stageTo: 'zoom', body: 'Booked a Zoom. Worried about price.' }),
    entry({ kind: 'whatsapp', outcome: null, step: null, stage: 'zoom', body: 'Sent the Zoom link.' }),
    entry({ kind: 'zoom', outcome: 'no_show', step: 'no_answer', stage: 'zoom' }),
    entry({ kind: 'call', outcome: 'answered', step: 'answered', stage: 'zoom', body: 'Rescheduled to Sunday.' }),
  ];

  it('numbers every phone call as an attempt and names the other entries', () => {
    expect(describeEntries(history)).toEqual([
      'ניסיון 1: אין מענה',
      'ניסיון 2: ענה ← פגישת זום',
      'הודעת וואטסאפ',
      'פגישת זום: הליד לא הגיע',
      'ניסיון 3: ענה',
    ]);
  });

  it('lists the timeline oldest first in the seller’s time zone, without contact details', () => {
    const { system, prompt } = buildCoachingPrompt({
      lead,
      interactions: [...history].reverse(),
      media: [],
      now: at('2026-10-22T07:00:00Z'),
      timeZone: 'Asia/Jerusalem',
      language: 'auto',
      businessContext: 'Premium websites for wineries and olive presses in the Galilee.',
    });
    expect(prompt).toContain('Today is Thu, 22 Oct 2026 (Asia/Jerusalem).');
    expect(prompt).toContain('<entry n="1" at="Thu, 1 Oct 2026, 11:00" type="ניסיון 1: אין מענה" />');
    expect(prompt.indexOf('Booked a Zoom')).toBeLessThan(prompt.indexOf('Rescheduled to Sunday'));
    expect(prompt).toContain('Stage: Zoom Meeting, since Fri, 2 Oct 2026');
    expect(prompt).toContain('Last contact: Fri, 2 Oct 2026, 11:00 (20 days ago)');
    expect(prompt).not.toMatch(/050-000-0142|moshe@arbel|arbel-olive\.example/);
    expect(system).toContain('Premium websites for wineries');
    expect(system).toContain('mostly written in');
  });

  it('shortens the oldest notes first when a history is very long', () => {
    const transcript = 'word '.repeat(12_000); // 60,000 characters, so the third one doesn't fit
    const long = [1, 2, 3].map((n) => entry({ kind: 'note', outcome: null, step: null, body: `T${n} ${transcript}`, at: at(`2026-10-1${n}T08:00:00Z`) }));
    const { prompt } = buildCoachingPrompt({
      lead,
      interactions: long,
      media: [],
      now: at('2026-10-22T07:00:00Z'),
      timeZone: 'Asia/Jerusalem',
      language: 'en',
      businessContext: '',
    });
    expect(prompt.length).toBeLessThan(160_000);
    expect(prompt).toContain('1 older entry was shortened to fit');
    expect(prompt).toMatch(/T1 (word ){10}/);
  });

  it('keeps every note and fits long transcripts into what is left, start and end first', () => {
    const transcript = `[Auto-Transcript]\nOPENING ${'blah '.repeat(40_000)} CLOSING: so Tuesday at ten.`;
    const call = entry({ kind: 'call', outcome: 'answered', step: 'answered', body: `Spoke for an hour.\n\n${transcript}`, at: at('2026-10-20T08:00:00Z') });
    const older = entry({ kind: 'note', outcome: null, step: null, body: `Older note ${'detail '.repeat(9_000)}END-OF-NOTE`, at: at('2026-10-10T08:00:00Z') });
    const done = { status: 'done' as const, partsDone: 7, partsTotal: 7, attempts: 1, error: null, text: '…', words: 40_000, updatedAt: at('2026-10-20T09:00:00Z') };
    const recording = { id: 'm1', leadId: 'lead-1', interactionId: call.id, kind: 'video' as const, fileName: 'zoom.mp4', mimeType: 'video/mp4', size: 1, storageKey: 'k', transcription: done, createdAt: at('2026-10-20T08:30:00Z') };
    const { prompt, system } = buildCoachingPrompt({
      lead,
      interactions: [call, older],
      media: [recording],
      now: at('2026-10-22T07:00:00Z'),
      timeZone: 'Asia/Jerusalem',
      language: 'auto',
      businessContext: '',
    });
    expect(prompt).toContain('END-OF-NOTE');
    expect(prompt).toContain('Spoke for an hour.');
    expect(prompt).toContain('OPENING');
    expect(prompt).toContain('CLOSING: so Tuesday at ten.');
    expect(prompt).toContain(' […] ');
    expect(prompt).toContain('recordings="1 video recording, transcribed below"');
    expect(prompt.length).toBeLessThan(160_000);
    expect(system).toContain('[Auto-Transcript]');

    const pending = { ...recording, transcription: { ...done, status: 'running' as const, text: null } };
    const second = { ...recording, id: 'm2', transcription: null };
    expect(buildCoachingPrompt({ lead, interactions: [call], media: [pending, second], now: at('2026-10-22T07:00:00Z'), timeZone: 'Asia/Jerusalem', language: 'auto', businessContext: '' }).prompt)
      .toContain('recordings="2 video recordings, 1 transcript not ready yet, 1 not transcribed"');
  });

  it('prepares a first call when nothing is logged yet', () => {
    const { prompt } = buildCoachingPrompt({
      lead: { ...lead, stage: 'cold_call', attemptCount: 0, lastAttemptAt: null },
      interactions: [],
      media: [],
      now: at('2026-10-22T07:00:00Z'),
      timeZone: 'Asia/Jerusalem',
      language: 'he',
      businessContext: '',
    });
    expect(prompt).toContain('<timeline entries="0">');
    expect(prompt).toContain('Prepare the first call to this lead, with a plan and a price to have ready.');
    expect(prompt).toContain('<price_history currency="ILS">\nNo closed deals with amounts yet.\n</price_history>');
  });

  it('anchors the price on the seller’s other closed deals, without naming them', () => {
    const closed = (id: string, campaign: string, deal: LeadRecord['deal'], extra: Partial<LeadRecord> = {}): LeadRecord => ({
      ...lead,
      id,
      name: `Business ${id}`,
      campaign,
      stage: 'closed',
      deal,
      ...extra,
    });
    const leads = [
      lead,
      closed('a', 'Food producers · Galilee', { setupFee: 11_500, monthlyRetainer: 0, hostingYearly: 750 }),
      closed('b', 'Food producers', { setupFee: 13_500, monthlyRetainer: 600, hostingYearly: 900 }),
      closed('c', 'Dentists', { setupFee: 18_000, monthlyRetainer: 450, hostingYearly: 0 }),
      closed('d', 'Dentists', { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 }),
      closed('e', 'Dentists', { setupFee: 99_000, monthlyRetainer: 0, hostingYearly: 0 }, { currency: 'USD' }),
      closed('f', 'Food producers', { setupFee: 50_000, monthlyRetainer: 0, hostingYearly: 0 }, { archivedAt: at('2026-10-01T08:00:00Z') }),
      { ...closed('g', 'Food producers', { setupFee: 70_000, monthlyRetainer: 0, hostingYearly: 0 }), stage: 'zoom' as const },
    ];
    const history = priceHistory(leads, lead);
    expect(history).toEqual({
      currency: 'ILS',
      priced: 3,
      setups: 3,
      setupFee: { median: 13_500, low: 11_500, high: 18_000 },
      retainers: 2,
      monthlyRetainer: { median: 525, low: 450, high: 600 },
      hosting: 2,
      hostingYearly: { median: 825, low: 750, high: 900 },
      niche: { name: 'Food producers', deals: 2, setupFee: { median: 12_500, low: 11_500, high: 13_500 } },
    });
    expect(describePriceHistory(history)).toEqual([
      'Setup fee: 3 of 3 closed deals (median 13,500, from 11,500 to 18,000)',
      'Monthly retainer: 2 of 3 closed deals (median 525, from 450 to 600 a month)',
      'Domain and hosting: 2 of 3 closed deals (median 825, from 750 to 900 a year)',
      'Same niche ("Food producers"): 2 closed, setup fee median 12,500, from 11,500 to 13,500',
    ]);

    const { prompt, system } = buildCoachingPrompt({
      lead,
      interactions: [],
      media: [],
      now: at('2026-10-22T07:00:00Z'),
      timeZone: 'Asia/Jerusalem',
      language: 'he',
      businessContext: '',
      prices: history,
    });
    expect(prompt).toContain('Deal currency: ILS');
    expect(prompt).toContain('<price_history currency="ILS">\nSetup fee: 3 of 3 closed deals');
    expect(prompt).not.toContain('Business a');
    expect(system).toContain('walk-away price');
    expect(system).toContain('nextCall.inDays');
  });

  it('gives a closed deal its terms, so the coach can see what to upsell', () => {
    const build = (deal: LeadRecord['deal'], stage: LeadRecord['stage'] = 'closed') =>
      buildCoachingPrompt({
        lead: { ...lead, stage, deal },
        interactions: history,
        media: [],
        now: at('2026-10-22T07:00:00Z'),
        timeZone: 'Asia/Jerusalem',
        language: 'he',
        businessContext: '',
      });
    expect(build({ setupFee: 18000, monthlyRetainer: 0, hostingYearly: 900 }).prompt).toContain(
      'Deal terms: setup fee 18,000 ILS; monthly retainer none; domain and hosting 900 ILS a year',
    );
    expect(build({ setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 }).prompt).not.toContain('Deal terms');
    expect(build({ setupFee: 18000, monthlyRetainer: 450, hostingYearly: 0 }, 'zoom').prompt).not.toContain('Deal terms');
    expect(build({ setupFee: 18000, monthlyRetainer: 0, hostingYearly: 0 }).system).toContain('natural upsell');
  });
});

describe('analysis schema', () => {
  it('meets both providers’ structured-output rules', () => {
    const visit = (node: Record<string, unknown>) => {
      expect(node).not.toHaveProperty('minLength');
      expect(node).not.toHaveProperty('maxLength');
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
        Object.values(node.properties as Record<string, Record<string, unknown>>).forEach(visit);
      }
      if (node.type === 'array') visit(node.items as Record<string, unknown>);
    };
    visit(ANALYSIS_JSON_SCHEMA);
    expect(Analysis.parse(sampleAnalysis)).toEqual(sampleAnalysis);
  });

  it('accepts enum values in any capitalization', () => {
    const shouted = { ...sampleAnalysis, dealHealth: 'Warm', objections: [{ ...sampleAnalysis.objections[0], status: 'OPEN' }] };
    expect(Analysis.parse(shouted)).toMatchObject({ dealHealth: 'warm', objections: [{ status: 'open' }] });
    expect(Analysis.safeParse({ ...sampleAnalysis, dealHealth: 'lukewarm' }).success).toBe(false);
  });

  it('keeps the analysis when the plan, the price or the closing objections come back wrong', () => {
    const { actionPlan: _plan, pricing: _pricing, closingObjections: _objections, ...core } = sampleAnalysis;
    const { inDays: _days, ...nextCall } = sampleAnalysis.nextCall;
    expect(Analysis.parse({ ...core, nextCall })).toMatchObject({ actionPlan: [], pricing: null, closingObjections: [], nextCall: { inDays: null } });
    expect(Analysis.parse({ ...sampleAnalysis, pricing: 'about 12k' }).pricing).toBeNull();

    const loose = Analysis.parse({
      ...sampleAnalysis,
      pricing: { ...sampleAnalysis.pricing, setupFee: 12_499.6, monthlyRetainer: -50, walkAwaySetupFee: 20_000 },
      closingObjections: [{ ...sampleAnalysis.closingObjections[0], likelihood: 'HIGH' }, { ...sampleAnalysis.closingObjections[0], likelihood: 'certain' }],
      nextCall: { ...sampleAnalysis.nextCall, inDays: 400 },
    });
    expect(loose.pricing).toMatchObject({ setupFee: 12_500, monthlyRetainer: 0, walkAwaySetupFee: 12_500 });
    expect(loose.closingObjections.map((item) => item.likelihood)).toEqual(['high', 'medium']);
    expect(loose.nextCall.inDays).toBe(60);
  });
});

describe('providers', () => {
  const received: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
  type Answer = { status: number; body: unknown; headers?: Record<string, string> };
  let reply: Answer = { status: 200, body: {} };
  /** Answers given before `reply`, one per request: a rate limit first, say */
  const queued: Answer[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw) });
      const answer = queued.shift() ?? reply;
      res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
      res.end(JSON.stringify(answer.body));
    });
  });
  let baseUrl = '';
  const request = { system: 'Coach.', prompt: 'The lead.', schema: ANALYSIS_JSON_SCHEMA, maxTokens: 8000 };

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it('asks Claude for structured output through the Messages API', async () => {
    reply = { status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(sampleAnalysis) }] } };
    const claude = createCoachProvider({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', baseUrl });
    expect(await claude.complete(request)).toEqual(sampleAnalysis);

    const sent = received.at(-1)!;
    expect(sent.path).toBe('/v1/messages');
    expect(sent.headers['x-api-key']).toBe('sk-ant-test');
    expect(sent.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 8000,
      system: 'Coach.',
      messages: [{ role: 'user', content: 'The lead.' }],
      output_config: { format: { type: 'json_schema', schema: ANALYSIS_JSON_SCHEMA } },
    });

    reply = { status: 200, body: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summary": "Mo' }] } };
    await expect(claude.complete(request)).rejects.toThrow(/ונקטע/);
    reply = { status: 200, body: { stop_reason: 'refusal', content: [] } };
    await expect(claude.complete(request)).rejects.toThrow(/סירב/);
  });

  it('asks OpenAI for a strict JSON schema through Chat Completions', async () => {
    reply = { status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sampleAnalysis), refusal: null } }] } };
    const openai = createCoachProvider({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-test', baseUrl: `${baseUrl}/` });
    expect(await openai.complete(request)).toEqual(sampleAnalysis);

    const sent = received.at(-1)!;
    expect(sent.path).toBe('/v1/chat/completions');
    expect(sent.headers.authorization).toBe('Bearer sk-test');
    expect(sent.body).toMatchObject({
      model: 'gpt-test',
      max_completion_tokens: 8000,
      messages: [
        { role: 'system', content: 'Coach.' },
        { role: 'user', content: 'The lead.' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'sales_coaching', strict: true, schema: ANALYSIS_JSON_SCHEMA } },
    });

    reply = { status: 200, body: { choices: [{ finish_reason: 'length', message: { content: '{"sum' } }] } };
    await expect(openai.complete(request)).rejects.toThrow(/ונקטע/);
    reply = { status: 200, body: { choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] } };
    await expect(openai.complete(request)).rejects.toThrow(/עצר לפני שסיים/);
  });

  it("asks Gemini through its OpenAI-compatible endpoint, with room to think", async () => {
    reply = { status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: '```json\n' + JSON.stringify(sampleAnalysis) + '\n```' } }] } };
    const gemini = createCoachProvider({ provider: 'gemini', apiKey: 'AIza-test', model: DEFAULT_MODELS.gemini, baseUrl: `${baseUrl}/v1beta/openai/` });
    expect(gemini.name).toBe('gemini');
    // A fenced answer still parses
    expect(await gemini.complete({ ...request, images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] })).toEqual(sampleAnalysis);

    const sent = received.at(-1)!;
    expect(sent.path).toBe('/v1beta/openai/chat/completions');
    expect(sent.headers.authorization).toBe('Bearer AIza-test');
    expect(sent.body).toMatchObject({
      model: 'gemini-3.8-flash',
      max_tokens: 8000 + 8192,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: 'Coach.' },
        { role: 'user', content: [{ type: 'text', text: 'The lead.' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
      ],
      response_format: { type: 'json_schema', json_schema: { strict: true, schema: ANALYSIS_JSON_SCHEMA } },
    });
    expect(sent.body).not.toHaveProperty('max_completion_tokens');

    // Gemini answers a wrong key with 400
    reply = { status: 400, body: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }] };
    await expect(gemini.complete(request)).rejects.toMatchObject({ message: expect.stringMatching(/AI_API_KEY/) });
  });

  it('waits and tries again when the provider is busy, as long as it asks for a short wait', async () => {
    const gemini = createCoachProvider({ provider: 'gemini', apiKey: 'k', model: 'm', baseUrl, retryDelayMs: 5 });
    reply = { status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sampleAnalysis) } }] } };
    const before = received.length;
    queued.push(
      { status: 429, body: { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.01s' }] } } },
      { status: 503, body: { error: { message: 'The model is overloaded.' } }, headers: { 'retry-after': '0' } },
    );
    expect(await gemini.complete(request)).toEqual(sampleAnalysis);
    expect(received.length - before).toBe(3);

    // A daily quota asks for hours: no waiting, a message about the free tier instead
    queued.push({ status: 429, body: { error: { details: [{ retryDelay: '43200s' }] } } });
    await expect(gemini.complete(request)).rejects.toMatchObject({ message: expect.stringMatching(/המכסה החינמית של Gemini/) });

    // Out of tries
    queued.push({ status: 429, body: {} }, { status: 429, body: {} }, { status: 429, body: {} });
    const openai = createCoachProvider({ provider: 'openai', apiKey: 'k', model: 'm', baseUrl, retryDelayMs: 1 });
    await expect(openai.complete(request)).rejects.toMatchObject({ message: expect.stringMatching(/מגבלת הקצב/) });
  });

  it('explains provider errors without passing their text on', async () => {
    const claude = createCoachProvider({ provider: 'anthropic', apiKey: 'wrong', model: 'claude-sonnet-5-5', baseUrl, retryDelayMs: 1 });
    reply = { status: 401, body: { error: { message: 'invalid x-api-key' } } };
    await expect(claude.complete(request)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/AI_API_KEY/) });
    reply = { status: 529, body: { error: { message: 'Overloaded' } } };
    await expect(claude.complete(request)).rejects.toMatchObject({ message: expect.stringMatching(/יש תקלה/) });
    const unreachable = createCoachProvider({ provider: 'openai', apiKey: 'x', model: 'm', baseUrl: 'http://127.0.0.1:9' });
    await expect(unreachable.complete(request)).rejects.toMatchObject({ status: 502 });
  });
});

describe('upgrading older data', () => {
  it('turns logged steps and old notes into timeline entries with their ids', async () => {
    const { legacyTimeline } = await import('../src/stores/legacy.js');
    const entries = legacyTimeline({
      _id: 'lead-9',
      activity: [
        { id: 'step-2', type: 'advanced', at: { $date: '2026-10-12T09:00:00Z' }, from: 'cold_call', to: 'zoom' },
        { id: 'step-1', type: 'no_answer', at: { $date: '2026-10-10T09:00:00Z' }, from: 'cold_call', to: null },
        { id: 'broken', type: 'unknown', at: 'not a date', from: 'cold_call' },
      ],
      notes: [
        { id: 'note-1', body: '  Wants an online shop.  ', createdAt: { $date: '2026-10-13T09:00:00Z' } },
        { id: 'note-2', body: '', createdAt: { $date: '2026-10-13T09:00:00Z' } },
      ],
    });
    expect(entries).toEqual([
      expect.objectContaining({ id: 'step-2', kind: 'call', outcome: 'answered', step: 'advanced', stage: 'cold_call', stageTo: 'zoom' }),
      expect.objectContaining({ id: 'step-1', kind: 'call', outcome: 'no_answer', step: 'no_answer' }),
      expect.objectContaining({ id: 'note-1', kind: 'note', body: 'Wants an online shop.', stage: 'zoom', leadId: 'lead-9' }),
    ]);
  });
});
