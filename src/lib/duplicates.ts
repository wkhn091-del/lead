import { LeadRegistry, sharedText, type IdentityKey, type IdentitySource, type KnownLead } from '../../server/src/leads/identity';
import { appConfig } from '../config';
import type { DeletedLead, Lead } from '../types';

/** The lead a business already is, or was before it was deleted */
export interface DuplicateLead {
  id: string;
  name: string;
  city: string;
  phone: string;
  /** Deleted from the CRM, rather than in it now */
  deleted: boolean;
  /** When it was deleted (ISO), for a deleted one */
  deletedAt: string | null;
  /** In the CRM and marked not relevant */
  archived: boolean;
  by: IdentityKey;
  /** What they share, as the app says it: "אותו מספר טלפון" */
  shared: string;
}

/**
 * Tells which lead a business already is, or was: the same number (however it's written), Google Maps place,
 * website, email, or name in the same city, as the server's import judges it (server/src/leads/identity.ts).
 * Built once for the leads and the deleted ones, then asked per business. A lead in the CRM comes before a deleted one.
 */
export function duplicateFinder(leads: readonly Lead[], deleted: readonly DeletedLead[]): (business: IdentitySource) => DuplicateLead | null {
  const registry = new LeadRegistry<KnownLead>([...leads, ...deleted], appConfig.defaultCountryCode);
  return (business) => {
    if (!business.name.trim() && !business.phone?.trim() && !business.email?.trim() && !business.website?.trim() && !business.mapsUrl?.trim()) return null;
    const found = registry.find(business);
    if (!found) return null;
    const { lead } = found;
    return {
      id: lead.id,
      name: lead.name,
      city: lead.city ?? '',
      phone: lead.phone ?? '',
      deleted: found.deleted,
      deletedAt: found.deleted && lead.deletedAt ? new Date(lead.deletedAt).toISOString() : null,
      archived: !found.deleted && Boolean(lead.archivedAt),
      by: found.by,
      shared: sharedText(found.by, business, lead),
    };
  };
}
