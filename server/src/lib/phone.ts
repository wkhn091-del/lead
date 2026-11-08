/**
 * Phone numbers as international digits (972541234567), however a lead's number was typed or imported:
 * "054-123-4567", "+972 54 123 4567", "00972…". Used to spot duplicates in imports and in the Prospector.
 */

/**
 * International digits for a number as people write it, or null when it can't be a phone number.
 * A leading 0 is the local trunk prefix: it's replaced by `countryCode` (Israel: 054… → 97254…).
 */
export function internationalDigits(phone: string, countryCode: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    // Already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = countryCode + digits.slice(1);
  } else if (!digits.startsWith(countryCode) && digits.length <= 10) {
    // A local number typed without its 0 (541234567)
    digits = countryCode + digits;
  }
  // The shortest international numbers have 8 digits, the longest 15 (E.164)
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** An Israeli number without its country code: mobile, VoIP (07…), landline, or a 1-599/1-700/1-800 line */
const ISRAELI_NATIONAL = /^(?:5\d{8}|7\d{8}|[2-489]\d{7}|1(?:599|700|800)\d{6})$/;

/**
 * A number as international digits, the same way whoever wrote it: 054-1234567, 0541234567, +972 54-123-4567
 * and "+972 054…" (the local 0 kept after the country code) are all 972541234567. Null when it can't be a number.
 */
export function phoneKey(phone: string, countryCode: string): string | null {
  let digits = internationalDigits(phone, countryCode);
  if (!digits) return null;
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  // An Israeli number has a known length, so a number cut short isn't saved as if it were one
  if (digits.startsWith('972') && !ISRAELI_NATIONAL.test(digits.slice(3))) return null;
  return digits;
}
