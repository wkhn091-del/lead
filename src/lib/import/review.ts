import { NO_DEAL } from '../deal';
import { createId } from '../id';
import { toInternational } from '../phone';
import type { ContactMethod, Currency, Lead, NewLead } from '../../types';
import type { ParsedRow } from './parse';

export type RowIssue = 'missing-name' | 'in-crm' | 'repeated';

export interface ReviewedRow extends ParsedRow {
  issue: RowIssue | null;
  /** Name of the existing lead or earlier row this one matches */
  match: string | null;
}

interface Contact {
  name: string;
  phone: string;
  email: string;
}

const nameKey = (name: string) =>
  name
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Finds a lead by phone (in any format), email, or name when one side has no contact details. */
class ContactIndex {
  private phones = new Map<string, string>();
  private emails = new Map<string, string>();
  private names = new Map<string, { name: string; reachable: boolean }>();

  add({ name, phone, email }: Contact) {
    const phoneKey = phone ? toInternational(phone) : null;
    if (phoneKey && !this.phones.has(phoneKey)) this.phones.set(phoneKey, name);
    if (email && !this.emails.has(email.toLowerCase())) this.emails.set(email.toLowerCase(), name);
    const key = nameKey(name);
    if (key && !this.names.has(key)) this.names.set(key, { name, reachable: Boolean(phone || email) });
  }

  find({ name, phone, email }: Contact): string | null {
    const phoneKey = phone ? toInternational(phone) : null;
    if (phoneKey && this.phones.has(phoneKey)) return this.phones.get(phoneKey) ?? null;
    if (email && this.emails.has(email.toLowerCase())) return this.emails.get(email.toLowerCase()) ?? null;
    // Same name: a duplicate unless both have different contact details (two branches of one business).
    const named = this.names.get(nameKey(name));
    if (named && (!named.reachable || (!phone && !email))) return named.name;
    return null;
  }
}

/** Flags rows without a name, rows already in the CRM, and rows that repeat earlier in the paste. */
export function reviewRows(rows: readonly ParsedRow[], existing: readonly Lead[]): ReviewedRow[] {
  const crm = new ContactIndex();
  for (const lead of existing) crm.add(lead);
  const paste = new ContactIndex();

  return rows.map((row) => {
    if (!row.name.trim()) return { ...row, issue: 'missing-name', match: null };
    const inCrm = crm.find(row);
    const repeated = inCrm ? null : paste.find(row);
    paste.add(row);
    if (inCrm) return { ...row, issue: 'in-crm', match: inCrm };
    if (repeated) return { ...row, issue: 'repeated', match: repeated };
    return { ...row, issue: null, match: null };
  });
}

export interface ImportDefaults {
  method: ContactMethod;
  /** Campaign for rows that don't name one, usually the batch's niche */
  campaign: string;
  currency: Currency;
}

const NOTE_LIMIT = 2000;

/**
 * Turns reviewed rows into leads at Cold Call, ready for the daily draw. Each lead is 1 ms older than
 * the one before it, so "Newest first" shows them in the order they were pasted.
 */
export function buildLeads(rows: readonly ParsedRow[], defaults: ImportDefaults, now = Date.now()): NewLead[] {
  return rows.map((row, index) => {
    const createdAt = new Date(now - index).toISOString();
    const notes = row.notes.trim();
    return {
      id: createId(),
      name: row.name.trim().slice(0, 120),
      contactName: row.contactName.trim().slice(0, 120),
      phone: row.phone.slice(0, 32),
      email: row.email.slice(0, 254),
      website: row.website.slice(0, 500),
      campaign: (row.campaign.trim() || defaults.campaign.trim()).slice(0, 60),
      approach: row.approach.trim().slice(0, 2000),
      method: row.method ?? defaults.method,
      stage: 'cold_call',
      stageChangedAt: createdAt,
      archivedAt: null,
      attemptCount: 0,
      lastAttemptAt: null,
      deal: { ...NO_DEAL },
      currency: defaults.currency,
      notes: notes ? [{ id: createId(), body: notes.slice(0, NOTE_LIMIT), createdAt }] : [],
      activity: [],
      createdAt,
      updatedAt: createdAt,
    };
  });
}
