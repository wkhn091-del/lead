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
