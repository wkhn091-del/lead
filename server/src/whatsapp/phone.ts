/**
 * Matching WhatsApp chats to leads by phone number. WhatsApp numbers are international digits
 * (972541234567); leads hold whatever was typed or imported: "054-123-4567", "+972 54 123 4567", "00972…".
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

export interface PhoneMatchLead {
  id: string;
  phone: string;
}

/** Leads by their WhatsApp number. Two leads can share a number (a duplicate import); both get the chat. */
export class LeadPhoneIndex {
  private readonly byPhone = new Map<string, string[]>();

  constructor(leads: readonly PhoneMatchLead[], countryCode: string) {
    for (const lead of leads) {
      const digits = internationalDigits(lead.phone, countryCode);
      if (!digits) continue;
      this.byPhone.set(digits, [...(this.byPhone.get(digits) ?? []), lead.id]);
    }
  }

  leadsFor(digits: string | null): string[] {
    return digits ? (this.byPhone.get(digits) ?? []) : [];
  }

  get size(): number {
    return this.byPhone.size;
  }
}
