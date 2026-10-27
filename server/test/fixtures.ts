import type { Analysis } from '../src/coach/schema.js';

/** A complete answer in the analysis schema, for the stand-in AI */
export const sampleAnalysis: Analysis = {
  summary: 'Moshe is interested but stalled on price after the first call.',
  dealHealth: 'warm',
  actionPlan: [
    { step: 'Send the homepage mockup on WhatsApp.', when: 'today', why: 'He sees the value before the price comes up again.' },
    { step: 'Confirm the Zoom the evening before.', when: 'Saturday evening', why: 'The last one was missed.' },
  ],
  pricing: {
    setupFee: 12_500,
    monthlyRetainer: 450,
    hostingYearly: 800,
    walkAwaySetupFee: 10_000,
    scope: ['Homepage, story and shop pages', 'Online orders before the holidays'],
    rationale: 'Your two closed food-producer deals were 11,500 and 13,500.',
    howToPresent: 'The site with online orders is 12,500, and it pays for itself with one extra order a week.',
  },
  closingObjections: [
    { objection: 'It’s still a lot of money for us.', likelihood: 'high', why: 'He raised the price on attempt 2.', response: 'Let’s look at what one more order a week brings you.' },
  ],
  wentWell: ['Attempt 2: you booked the Zoom on the same call.'],
  wentWrong: ['Attempt 2: the price came up before the value did.'],
  mistakes: [
    {
      mistake: 'You quoted a price before showing the mockup.',
      evidence: 'Attempt 2: "15,000 is too much".',
      fix: 'Show the homepage mockup first, then anchor the price to one extra order a week.',
    },
  ],
  objections: [{ objection: '15,000 is too much', status: 'open', response: 'Let’s look at what one extra order a week is worth to you.' }],
  openQuestions: ['Who else decides on the budget?'],
  tips: ['Send the mockup on WhatsApp before the Zoom.'],
  nextCall: {
    goal: 'Confirm the Zoom and get the mockup in front of him.',
    timing: 'Sunday morning, before the press opens.',
    inDays: 2,
    script: [
      { step: 'Opener', say: 'Hi Moshe, it’s about the homepage I mocked up for you.' },
      { step: 'Ask', say: 'Can we look at it together on Zoom on Sunday at 10?' },
    ],
    fallbackMessage: 'Hi Moshe, I put together a homepage idea for the press. Can I send it?',
  },
};

/**
 * A 16 kHz mono WAV: each segment is [seconds, frequency], with 0 for silence. Real audio, so ffmpeg can
 * extract it, find the pauses and cut it.
 */
export function makeWav(segments: readonly [number, number][], rate = 16_000): Buffer {
  const samples = segments.flatMap(([seconds, frequency]) =>
    Array.from({ length: Math.round(seconds * rate) }, (_, i) => (frequency ? Math.round(9000 * Math.sin((2 * Math.PI * frequency * i) / rate)) : 0)),
  );
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(sample, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
