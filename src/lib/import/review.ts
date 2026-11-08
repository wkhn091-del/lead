import { IdentityIndex, LeadRegistry, type IdentitySource, type KnownLead } from '../../../server/src/leads/identity';
import { appConfig } from '../../config';
import { NO_DEAL } from '../deal';
import { createId } from '../id';
import type { ContactMethod, Currency, DeletedLead, Lead, NewLead } from '../../types';
import type { ParsedRow } from './parse';

export type RowIssue = 'missing-name' | 'in-crm' | 'deleted' | 'repeated';

export interface ReviewedRow extends ParsedRow {
  issue: RowIssue | null;
  /** Name of the lead (in the CRM or deleted) or the earlier row this one is */
  match: string | null;
  /** When the lead it was is deleted ('deleted'), ISO */
  deletedAt?: string | null;
}

/**
 * Flags rows without a name, businesses already in the CRM, ones that were and were deleted, and rows that repeat
 * an earlier one: the same number (in any format), website, email, or name with nothing to tell them apart
 * (server/src/leads/identity.ts, as the JSON import judges it).
 */
export function reviewRows(rows: readonly ParsedRow[], existing: readonly Lead[], deleted: readonly DeletedLead[] = []): ReviewedRow[] {
  const crm = new LeadRegistry<KnownLead>([...existing, ...deleted], appConfig.defaultCountryCode);
  const paste = new IdentityIndex<IdentitySource>(appConfig.defaultCountryCode);

  return rows.map((row) => {
    if (!row.name.trim()) return { ...row, issue: 'missing-name', match: null };
    const business: IdentitySource = { name: row.name, phone: row.phone, email: row.email, website: row.website };
    const inCrm = crm.find(business);
    const repeated = inCrm ? null : paste.find(business);
    paste.add(business);
    if (inCrm?.deleted) {
      const at = inCrm.lead.deletedAt;
      return { ...row, issue: 'deleted', match: inCrm.lead.name, deletedAt: at ? new Date(at).toISOString() : null };
    }
    if (inCrm) return { ...row, issue: 'in-crm', match: inCrm.lead.name };
    if (repeated) return { ...row, issue: 'repeated', match: repeated.lead.name };
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
