import { describe, expect, it } from 'vitest';

/**
 * The CRM never sends anything to a lead: no email, WhatsApp message, SMS or link. In the browser that
 * means no link that composes a message for you. Opening your own phone or WhatsApp on a lead's chat is
 * fine (you type and send yourself); a link that fills in the text is not.
 */

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const PREFILLED = [
  /[?&]text=/, // wa.me/…?text=, api.whatsapp.com/send?text=
  /api\.whatsapp\.com\/send/,
  /whatsapp:\/\/send/,
  /\bsms:/,
  /mailto:[^'"`\s]*\?/, // mailto: with a subject or body
  /[?&](subject|body)=/,
];

describe('outbound policy (browser)', () => {
  it('reads the whole app', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    expect(Object.keys(sources)).toContain('../components/profile/CoachPanel.tsx');
  });

  it('has no link that writes a message for you', () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      text.split('\n').flatMap((line, index) => (PREFILLED.some((pattern) => pattern.test(line)) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
