import { randomUUID } from 'node:crypto';
import { LeadInput } from '../leads/leads.schemas.js';
import type { LeadRecord } from '../stores/types.js';
import { internationalDigits } from '../whatsapp/phone.js';
import { domainOf, notAWebsite } from './site.js';
import type { ProspectRecord, ProspectSearchRecord } from './types.js';

/**
 * Prospects becoming leads. An imported business starts at Cold Call like any import, so it joins the pool the
 * Daily 10 is drawn from (and tops up today's queue if it's short). Its "how to talk to them" holds the
 * opening line, and its timeline starts with the site analysis, which the AI coach reads when you prep.
 */

export const SCORE_LABEL: Record<number, string> = {
  5: 'אין אתר פעיל',
  4: 'מיושן מאוד',
  3: 'בינוני',
  2: 'סביר',
  1: 'פרימיום',
};

/** Leads already in the CRM, by phone and by their own website's domain */
export class LeadMatcher {
  private readonly byPhone = new Map<string, string>();
  private readonly byDomain = new Map<string, string>();

  constructor(leads: readonly Pick<LeadRecord, 'id' | 'phone' | 'website'>[], private readonly countryCode: string) {
    for (const lead of leads) {
      const digits = internationalDigits(lead.phone, countryCode);
      if (digits && !this.byPhone.has(digits)) this.byPhone.set(digits, lead.id);
      const domain = ownDomain(lead.website);
      if (domain && !this.byDomain.has(domain)) this.byDomain.set(domain, lead.id);
    }
  }

  find(prospect: Pick<ProspectRecord, 'phoneIntl' | 'phone' | 'website'>): string | null {
    const digits = prospect.phoneIntl || internationalDigits(prospect.phone, this.countryCode);
    const byPhone = digits ? this.byPhone.get(digits) : undefined;
    if (byPhone) return byPhone;
    const domain = ownDomain(prospect.website);
    return (domain && this.byDomain.get(domain)) || null;
  }

  add(lead: Pick<LeadRecord, 'id' | 'phone' | 'website'>) {
    const digits = internationalDigits(lead.phone, this.countryCode);
    if (digits) this.byPhone.set(digits, lead.id);
    const domain = ownDomain(lead.website);
    if (domain) this.byDomain.set(domain, lead.id);
  }
}

/** A website's domain, unless the link is a Facebook page, a directory listing or the like (shared by many businesses) */
export function ownDomain(website: string): string {
  if (!website.trim() || notAWebsite(website)) return '';
  return domainOf(website);
}

/** "חדרי כושר · תל אביב", within the campaign field's 60 characters */
export function campaignFor(search: Pick<ProspectSearchRecord, 'niche' | 'location'>): string {
  const full = `${search.niche} · ${search.location}`;
  return full.length <= 60 ? full : `${full.slice(0, 59).trimEnd()}…`;
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** What the Prospector found, as the lead's first timeline note */
export function reportNote(prospect: ProspectRecord, search: ProspectSearchRecord): string {
  const { analysis } = prospect;
  const lines: string[] = [];
  lines.push(`נמצא במאתר הלידים: ${search.niche} · ${search.location} (${dateFormat.format(search.createdAt)})`);
  if (analysis.score !== null) {
    lines.push(`ציון צורך: ${analysis.score}/5 (${SCORE_LABEL[analysis.score]})${analysis.verdict ? ` · ${analysis.verdict}` : ''}`);
  } else if (analysis.verdict) {
    lines.push(analysis.verdict);
  }
  for (const reason of analysis.reasons.slice(0, 4)) lines.push(`• ${reason}`);
  if (analysis.pitch) lines.push(`פתיחה לשיחה: ${analysis.pitch}`);
  lines.push('');
  if (prospect.website) {
    const tech = analysis.signals?.tech.slice(0, 4).join(', ');
    lines.push(`אתר: ${prospect.website}${tech ? ` (${tech})` : ''}`);
  } else {
    lines.push('אתר: אין');
  }
  const google = [
    prospect.rating !== null ? `★${prospect.rating.toLocaleString('he-IL', { maximumFractionDigits: 1 })}` : null,
    prospect.reviews !== null ? `${prospect.reviews.toLocaleString('he-IL')} ביקורות` : null,
    prospect.category || null,
  ].filter(Boolean);
  if (google.length) lines.push(`בגוגל: ${google.join(' · ')}`);
  if (prospect.unclaimed) lines.push('הכרטיס בגוגל לא נתבע על ידי בעל העסק');
  if (prospect.closed) lines.push('בגוגל העסק מסומן כסגור זמנית');
  if (prospect.address) lines.push(`כתובת: ${prospect.address}`);
  if (prospect.mapsUrl) lines.push(`במפות: ${prospect.mapsUrl}`);
  return lines.join('\n').slice(0, 5000);
}

/** The opening line and the score, for the lead's "how to talk to them" (shown on its Daily 10 card) */
export function approachFor(prospect: ProspectRecord): string {
  const { analysis } = prospect;
  const head = analysis.score !== null ? `ציון צורך ${analysis.score}/5${analysis.verdict ? `: ${analysis.verdict}` : ''}` : analysis.verdict;
  return [head, analysis.pitch].filter(Boolean).join('\n').slice(0, 2000);
}

/** The lead to create for a prospect, checked by the same rules as any new lead */
export function leadFor(prospect: ProspectRecord, search: ProspectSearchRecord, now: Date): LeadInput {
  const base = {
    id: randomUUID(),
    name: prospect.name.slice(0, 120),
    contactName: '',
    phone: prospect.phone.replace(/[^0-9+()\-.\s]/g, '').slice(0, 32),
    email: prospect.analysis.signals?.emails[0] ?? '',
    // A Facebook page or directory link is kept too: it's still where to look before the call.
    website: prospect.website,
    campaign: campaignFor(search),
    approach: approachFor(prospect),
    method: 'call' as const,
    currency: 'ILS' as const,
    notes: [{ id: randomUUID(), body: reportNote(prospect, search), createdAt: now.toISOString() }],
    createdAt: now.toISOString(),
  };
  const parsed = LeadInput.safeParse(base);
  if (parsed.success) return parsed.data;
  // A listing detail the CRM wouldn't accept (an odd website address, an unusual email) is left out rather than failing the import.
  return LeadInput.parse({ ...base, email: '', website: LeadInput.shape.website.safeParse(base.website).success ? base.website : '' });
}
