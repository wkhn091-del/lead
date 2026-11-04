import { describe, expect, it } from 'vitest';
import { whatsAppHref } from './phone';

/**
 * The CRM never sends anything to a lead by itself: no email, WhatsApp message or SMS goes out without you. The
 * WhatsApp button opens your own WhatsApp on the lead's chat with a ready message from your template, and you send
 * it there. So one place may put text in a link, whatsAppHref in lib/phone.ts, and only for wa.me; no other link
 * composes or sends a message (WhatsApp's send API, SMS, an email with a body).
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

/** The one function that builds a WhatsApp link with text in it */
const READY_MESSAGE_LINK = './phone.ts';

describe('outbound policy (browser)', () => {
  it('reads the whole app', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    expect(Object.keys(sources)).toContain('../components/profile/CoachPanel.tsx');
  });

  it('writes a message into a link in one place only: the wa.me link you open yourself', () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      text.split('\n').flatMap((line, index) => {
        const allowed = path === READY_MESSAGE_LINK && /https:\/\/wa\.me\/\$\{number\}\?text=/.test(line);
        return !allowed && PREFILLED.some((pattern) => pattern.test(line)) ? [`${path}:${index + 1}: ${line.trim()}`] : [];
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('builds a wa.me link with the message ready, and nothing else', () => {
    expect(whatsAppHref('054-123-4567', 'שלום דני, כאן סטודיו עומק')).toBe(
      `https://wa.me/972541234567?text=${encodeURIComponent('שלום דני, כאן סטודיו עומק')}`,
    );
    expect(whatsAppHref('054-123-4567')).toBe('https://wa.me/972541234567');
    expect(whatsAppHref('054-123-4567', '  ')).toBe('https://wa.me/972541234567');
    expect(whatsAppHref('אין')).toBeNull();
  });
});
