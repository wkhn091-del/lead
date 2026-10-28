import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createMemoryStores } from '../src/stores/memory.js';
import { TranscriptionError } from '../src/transcription/errors.js';
import { findFfmpeg, planParts, prepareAudio, runFfmpeg } from '../src/transcription/ffmpeg.js';
import { cleanKeywords, createOpenAITranscriber, type Transcriber } from '../src/transcription/openai.js';
import { joinParts, transcribeRecording } from '../src/transcription/pipeline.js';
import { createTranscriptionQueue } from '../src/transcription/queue.js';
import { TEST_EMAIL, TEST_PASSWORD } from './credentials.js';
import { makeWav } from './fixtures.js';

const ffmpeg = await findFfmpeg();
const work = await mkdtemp(join(tmpdir(), 'omek-transcription-test-'));
afterAll(() => rm(work, { recursive: true, force: true }));

/** 8 s of speech-like tone, a 2 s pause, and so on: pauses at 8–10 s and 18–20 s, 28 s in all */
const threePhrases = makeWav([
  [8, 440],
  [2, 0],
  [8, 520],
  [2, 0],
  [8, 600],
]);

describe('cutting recordings into parts', () => {
  it('cuts at the longest pause before each target, or at the target when there is none', () => {
    const silences = [
      { start: 290, end: 291 },
      { start: 560, end: 563 }, // the longest pause in the window before 600 s
      { start: 590, end: 591 },
      { start: 1150, end: 1152 },
    ];
    expect(planParts(1500, silences, 600, 90)).toEqual([
      { start: 0, end: 561.5 },
      { start: 561.5, end: 1151 },
      { start: 1151, end: 1500 },
    ]);
    expect(planParts(1250, [], 600)).toEqual([
      { start: 0, end: 600 },
      { start: 600, end: 1250 }, // 650 s is within 10% of a part, so it isn't split again
    ]);
    expect(planParts(1300, [], 600).map((part) => part.end)).toEqual([600, 1200, 1300]);
    expect(planParts(300, [], 600)).toEqual([{ start: 0, end: 300 }]);
    expect(planParts(Number.NaN, [], 600)).toEqual([{ start: 0, end: 0 }]);
  });

  it('joins parts into paragraphs, unless a part ends mid-sentence', () => {
    expect(joinParts(['Hi Moshe, it is Rozen.', '  So about the site', 'we built for Arbel.', ''])).toBe(
      'Hi Moshe, it is Rozen.\n\nSo about the site we built for Arbel.',
    );
  });

  it('cleans keywords the way the API requires', () => {
    expect(cleanKeywords(['Hadar Real Estate', 'hadar real estate', ' <Daniel>\nHadar ', '', 'x'.repeat(80)])).toEqual([
      'Hadar Real Estate',
      'Daniel Hadar',
      'x'.repeat(60),
    ]);
  });
});

describe.skipIf(!ffmpeg)('ffmpeg', () => {
  it("extracts the audio, finds the pauses, and explains files it can't use", async () => {
    const input = join(work, 'phrases.wav');
    await writeFile(input, threePhrases);
    const audio = await prepareAudio(ffmpeg!, input, join(work, 'phrases.mp3'));
    expect(audio.duration).toBeGreaterThan(27.5);
    expect(audio.silences).toHaveLength(2);
    expect(audio.silences[0].start).toBeCloseTo(8, 0);
    expect(audio.silences[1].end).toBeCloseTo(20, 0);

    // A Zoom-style video: the audio track is taken, the picture ignored.
    const video = join(work, 'zoom.mp4');
    await runFfmpeg(ffmpeg!, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', video]);
    expect((await prepareAudio(ffmpeg!, video, join(work, 'zoom.mp3'))).duration).toBeGreaterThan(2.5);

    const silent = join(work, 'screen.mp4');
    await runFfmpeg(ffmpeg!, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=5', '-c:v', 'mpeg4', silent]);
    await expect(prepareAudio(ffmpeg!, silent, join(work, 'screen.mp3'))).rejects.toThrow('אין פס קול');

    const broken = join(work, 'broken.m4a');
    await writeFile(broken, 'not audio at all');
    await expect(prepareAudio(ffmpeg!, broken, join(work, 'broken.mp3'))).rejects.toThrow(TranscriptionError);
  });

  it('sends every part in order, each with the end of the last as context, and joins the text', async () => {
    const input = join(work, 'call.wav');
    await writeFile(input, threePhrases);
    const sent: { size: number; prompt?: string; keywords?: string[] }[] = [];
    const transcriber: Transcriber = {
      service: 'test',
      model: 'test',
      async transcribe(file, options) {
        const { size } = await import('node:fs/promises').then((fs) => fs.stat(file));
        sent.push({ size, prompt: options?.prompt, keywords: options?.keywords });
        return `Part ${sent.length} ends here.`;
      },
    };
    const progress: string[] = [];
    const text = await transcribeRecording(input, {
      ffmpeg: ffmpeg!,
      transcriber,
      partSeconds: 10,
      keywords: ['Hadar Real Estate'],
      onProgress: (done, total) => {
        progress.push(`${done}/${total}`);
      },
    });
    expect(text).toBe('Part 1 ends here.\n\nPart 2 ends here.\n\nPart 3 ends here.');
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);
    expect(sent.map((part) => part.prompt)).toEqual([undefined, 'Part 1 ends here.', 'Part 1 ends here.\n\nPart 2 ends here.']);
    expect(sent.every((part) => part.size > 10_000 && part.size < 25 * 1024 * 1024)).toBe(true);
    expect(sent[0].keywords).toEqual(['Hadar Real Estate']);
  });
});

describe('OpenAI transcription requests', () => {
  const received: { path: string; headers: IncomingMessage['headers']; form: FormData }[] = [];
  let replies: { status: number; body: string; headers?: Record<string, string> }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const form = await new Request('http://local/', {
        method: 'POST',
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      }).formData();
      received.push({ path: req.url ?? '', headers: req.headers, form });
      const reply = replies.shift() ?? { status: 200, body: JSON.stringify({ text: 'Shalom, this is the transcript.' }) };
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.body);
    });
  });
  let baseUrl = '';
  let part = '';

  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    part = join(work, 'part-000.mp3');
    await writeFile(part, Buffer.alloc(2048, 1));
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it('sends gpt-transcribe the file with languages[], keywords[] and the prompt', async () => {
    const transcriber = createOpenAITranscriber({ apiKey: 'sk-test', baseUrl, language: 'he' });
    expect(transcriber).toMatchObject({ model: 'gpt-transcribe', service: new URL(baseUrl).host });
    const text = await transcriber.transcribe(part, { prompt: 'End of the last part.', keywords: ['Hadar Real Estate', 'Daniel'] });
    expect(text).toBe('Shalom, this is the transcript.');

    const { path, headers, form } = received.at(-1)!;
    expect(path).toBe('/v1/audio/transcriptions');
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['he']);
    expect(form.getAll('keywords[]')).toEqual(['Hadar Real Estate', 'Daniel']);
    expect(form.get('prompt')).toBe('End of the last part.');
    expect(form.get('language')).toBeNull();
    const file = form.get('file') as File;
    expect([file.name, file.type, file.size]).toEqual(['part-000.mp3', 'audio/mpeg', 2048]);
  });

  it('sends older models one language and the names inside the prompt', async () => {
    const transcriber = createOpenAITranscriber({ apiKey: 'sk-test', baseUrl, model: 'whisper-1', language: 'he' });
    await transcriber.transcribe(part, { prompt: 'End of the last part.', keywords: ['Hadar Real Estate'] });
    const { form } = received.at(-1)!;
    expect(form.get('language')).toBe('he');
    expect(form.getAll('languages[]')).toEqual([]);
    expect(form.get('prompt')).toBe('Hadar Real Estate. End of the last part.');
  });

  it('drops a refused language hint, waits out rate limits, and explains other failures', async () => {
    const transcriber = createOpenAITranscriber({ apiKey: 'sk-test', baseUrl, language: 'he' });
    replies = [
      { status: 400, body: JSON.stringify({ error: { message: 'Unsupported language code: he' } }) },
      { status: 429, body: '{}', headers: { 'retry-after': '1' } },
      { status: 200, body: JSON.stringify({ text: 'Recovered.' }) },
    ];
    const before = received.length;
    expect(await transcriber.transcribe(part)).toBe('Recovered.');
    const forms = received.slice(before).map((entry) => entry.form.getAll('languages[]'));
    expect(forms).toEqual([['he'], [], []]);

    replies = [{ status: 401, body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }) }];
    await expect(transcriber.transcribe(part)).rejects.toThrow(/TRANSCRIBE_API_KEY/);
  });
});

describe.skipIf(!ffmpeg)('transcripts in the app', () => {
  const stores = createMemoryStores();
  let mediaDir = '';
  let release: (() => void) | null = null;
  let failNext: string | null = null;
  const calls: { file: string; keywords?: string[] }[] = [];
  /** Stands in for OpenAI: answers per part, can fail once, or hold until released (or aborted) */
  const transcriber: Transcriber = {
    service: 'OpenAI',
    model: 'gpt-transcribe',
    async transcribe(file, options) {
      calls.push({ file, keywords: options?.keywords });
      if (failNext) {
        const message = failNext;
        failNext = null;
        throw new TranscriptionError(message);
      }
      if (release === null && options?.signal) {
        // Hold this part until the test releases it, or the job is cancelled.
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
        });
        release = null;
      }
      return `שלום, part ${calls.length}.`;
    },
  };
  let queue: ReturnType<typeof createTranscriptionQueue>;
  let agent: ReturnType<typeof request.agent>;

  const newLead = async (name: string) => {
    const id = randomUUID();
    await agent.post('/api/leads').send({ id, name, contactName: 'Daniel Hadar', method: 'call' }).expect(201);
    return id;
  };
  const step = (leadId: string, body = '') =>
    agent.post(`/api/leads/${leadId}/actions`).send({ id: randomUUID(), type: 'answered', from: 'cold_call', body }).expect(200);
  const upload = (leadId: string, interactionId?: string) => {
    const call = agent.post(`/api/leads/${leadId}/media`);
    if (interactionId) call.field('interactionId', interactionId);
    return call.attach('file', threePhrases, { filename: 'call.wav', contentType: 'audio/wav' });
  };
  const timeline = async (leadId: string) => (await agent.get(`/api/leads/${leadId}/timeline`).expect(200)).body;

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'omek-transcribe-media-'));
    const storage = createLocalStorage(mediaDir);
    queue = createTranscriptionQueue({ stores, storage, transcriber, ffmpeg: ffmpeg!, partSeconds: 10, keywords: ['Omek'] });
    const app = createApp({ stores, storage, coach: null, transcription: queue, maxUploadMb: 5 });
    agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
    release = () => {}; // don't hold parts unless a test asks for it
  });
  afterAll(async () => {
    queue.stop();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('transcribes a call recording in the background and adds it to that call', async () => {
    const leadId = await newLead('Hadar Real Estate');
    const call = (await step(leadId, 'Talked about listing sync.')).body.activity[0];
    const uploaded = await upload(leadId, call.id).expect(201);
    expect(uploaded.body.transcription).toMatchObject({ status: 'queued', partsDone: 0 });
    expect(uploaded.body.transcription.text).toBeUndefined();

    await queue.idle();
    const { interactions, media } = await timeline(leadId);
    const entry = interactions.find((item: { id: string }) => item.id === call.id);
    expect(entry.body).toMatch(/^Talked about listing sync\.\n\n\[Auto-Transcript\]\nשלום, part \d+\./);
    expect(entry.body.match(/\[Auto-Transcript\]/g)).toHaveLength(1);
    expect(media[0].transcription).toMatchObject({ status: 'done', partsDone: 3, partsTotal: 3, error: null });
    expect(media[0].transcription.words).toBeGreaterThan(0);
    expect(calls.at(-1)?.keywords).toEqual(['Hadar Real Estate', 'Daniel Hadar', 'Omek']);

    const status = (await agent.get(`/api/leads/${leadId}/media`).expect(200)).body;
    expect(status).toHaveLength(1);
    expect(status[0].storageKey).toBeUndefined();
  });

  it('gives a recording on the lead itself a note of its own', async () => {
    const leadId = await newLead('Shemesh Boutique Hotel');
    const uploaded = await upload(leadId).expect(201);
    await queue.idle();
    const { interactions, media } = await timeline(leadId);
    expect(interactions).toMatchObject([{ id: `transcript-${uploaded.body.id}`, kind: 'note', step: null }]);
    expect(interactions[0].body.startsWith('[Auto-Transcript]\n')).toBe(true);
    expect(media[0].interactionId).toBe(`transcript-${uploaded.body.id}`);
  });

  it('marks a failed transcript with the reason, and transcribes it again on request', async () => {
    const leadId = await newLead('Golan Steakhouse');
    const call = (await step(leadId)).body.activity[0];
    failNext = "The transcription service's rate limit or quota was reached. Try again later.";
    const uploaded = await upload(leadId, call.id).expect(201);
    await queue.idle();
    let [media] = (await agent.get(`/api/leads/${leadId}/media`).expect(200)).body;
    expect(media.transcription).toMatchObject({ status: 'failed', error: expect.stringMatching(/rate limit/) });
    expect((await timeline(leadId)).interactions[0].body).toBe('');

    const again = await agent.post(`/api/media/${uploaded.body.id}/transcribe`).expect(202);
    expect(again.body.transcription.status).toBe('queued');
    await queue.idle();
    [media] = (await agent.get(`/api/leads/${leadId}/media`).expect(200)).body;
    expect(media.transcription.status).toBe('done');
    expect((await timeline(leadId)).interactions[0].body).toMatch(/^\[Auto-Transcript\]/);
  });

  it('stops when the recording is deleted, and refuses an edit based on an older text', async () => {
    const leadId = await newLead('Kinneret Fish House');
    const call = (await step(leadId, 'Menu changes weekly.')).body.activity[0];
    release = null; // hold the first part
    const uploaded = await upload(leadId, call.id).expect(201);
    for (let i = 0; i < 100 && !release; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(release).not.toBeNull();
    await agent.post(`/api/media/${uploaded.body.id}/transcribe`).expect(409);
    await agent.delete(`/api/media/${uploaded.body.id}`).expect(204);
    await queue.idle();
    release = () => {};
    const entry = (await timeline(leadId)).interactions[0];
    expect(entry.body).toBe('Menu changes weekly.');

    // An edit made from an older copy of the entry gets a 409 instead of overwriting what changed.
    await agent
      .patch(`/api/leads/${leadId}/interactions/${call.id}`)
      .send({ body: 'Menu changes weekly. Wants a QR menu.', expectedUpdatedAt: entry.updatedAt })
      .expect(200);
    await agent
      .patch(`/api/leads/${leadId}/interactions/${call.id}`)
      .send({ body: 'Stale edit', expectedUpdatedAt: entry.updatedAt })
      .expect(409);
  });

  it('picks up transcripts that were running when the server stopped', async () => {
    const leadId = await newLead('Yarden Kayak Tours');
    const call = (await step(leadId)).body.activity[0];
    const uploaded = await upload(leadId, call.id).expect(201);
    await queue.idle();
    // As if the server stopped mid-job: the record still says running, with no text yet.
    await stores.media.setTranscription(uploaded.body.id, {
      status: 'running', partsDone: 1, partsTotal: 3, attempts: 1, error: null, text: null, words: 0, updatedAt: new Date(),
    });
    await stores.interactions.update(leadId, call.id, { body: '' });
    await queue.resume();
    await queue.idle();
    const [media] = (await agent.get(`/api/leads/${leadId}/media`).expect(200)).body;
    expect(media.transcription).toMatchObject({ status: 'done', partsDone: 3 });
    expect((await timeline(leadId)).interactions[0].body.match(/\[Auto-Transcript\]/g)).toHaveLength(1);
  });

  it('says it is on, and with which model', async () => {
    const features = (await agent.get('/api/features').expect(200)).body;
    expect(features.transcription).toEqual({ enabled: true, service: 'OpenAI', model: 'gpt-transcribe' });
  });
});
