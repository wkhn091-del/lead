import { appConfig } from '../config';

export const phoneDigits = (raw: string) => raw.replace(/\D/g, '');

/** True when the input has a plausible number of digits for a phone number. */
export function isValidPhone(raw: string): boolean {
  const count = phoneDigits(raw).length;
  return count >= 9 && count <= 15;
}

/** Local or international input to digits with a country code: 052-000-0187 becomes 972520000187. */
export function toInternational(raw: string): string | null {
  if (!isValidPhone(raw)) return null;
  const digits = phoneDigits(raw);
  if (raw.trim().startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return appConfig.defaultCountryCode + digits.slice(1);
  return digits;
}

export function telHref(raw: string): string | null {
  const number = toInternational(raw);
  return number ? `tel:+${number}` : null;
}

/**
 * Opens WhatsApp (the app on a phone, WhatsApp Web or the desktop app on a computer) on the chat with this number,
 * with `text` ready in the message box. Nothing is sent: you read it, change it if you like, and press send.
 */
export function whatsAppHref(raw: string, text = ''): string | null {
  const number = toInternational(raw);
  if (!number) return null;
  const message = text.trim();
  return message ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : `https://wa.me/${number}`;
}

/** Shows Israeli numbers as 052-000-0187 and leaves anything else as typed. */
export function formatPhone(raw: string): string {
  const digits = phoneDigits(raw);
  if (/^05\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (/^0[2-9]\d{7}$/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return raw.trim();
}
