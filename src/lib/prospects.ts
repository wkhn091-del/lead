import type { AnalysisStatus, NewLead, Prospect, ProspectSearch, SearchStatus, SiteSignals, SiteState } from '../types';
import { NO_DEAL } from './deal';
import { createId } from './id';

// The Prospector in the app: how scores, checks and searches read, which businesses to show, and the lead an
// imported business becomes (the server does that itself: server/src/prospector/importer.ts).

/** How much a business needs a new website (server/src/prospector/score.ts), as a seller reads it */
export const SCORE_META: Record<number, { label: string; tone: string }> = {
  5: { label: 'אין אתר פעיל', tone: 'var(--st-won)' },
  4: { label: 'מיושן מאוד', tone: 'var(--st-answered)' },
  3: { label: 'בינוני', tone: 'var(--st-no-answer)' },
  2: { label: 'סביר', tone: 'var(--fg-muted)' },
  1: { label: 'פרימיום', tone: 'var(--fg-faint)' },
};
export const SCORES = [5, 4, 3, 2, 1] as const;

/** Scores worth a call: an outdated site (4) or no working one (5) */
export const TARGET_SCORE = 4;

export const SITE_STATE_LABEL: Record<SiteState, string> = {
  none: 'אין אתר',
  social: 'רק עמוד ברשת חברתית',
  broken: 'האתר לא עובד',
  blocked: 'האתר חסם את הבדיקה',
  ok: 'אתר פעיל',
};

export const CHECK_LABEL: Record<AnalysisStatus, string> = {
  pending: 'ממתין לבדיקה',
  checking: 'בודק את האתר…',
  scoring: 'ה-AI נותן ציון…',
  done: 'נבדק',
  failed: 'הבדיקה נכשלה',
  skipped: 'לא נבדק',
};

export const SEARCH_STATUS_LABEL: Record<SearchStatus, string> = {
  discovering: 'מחפש עסקים בגוגל…',
  analyzing: 'בודק אתרים…',
  done: 'הסתיים',
  failed: 'נכשל',
  cancelled: 'נעצר',
};

/** Niches to start from. Any other works too. */
export const NICHE_IDEAS = ['מוסכים', 'עורכי דין', 'רואי חשבון', 'קבלני שיפוצים', 'רופאי שיניים', 'מסעדות', 'חדרי כושר', 'צימרים'];

export const isRunning = (search: Pick<ProspectSearch, 'status'>) => search.status === 'discovering' || search.status === 'analyzing';

/** Its website is still waiting for, or in, a check */
export const isChecking = (prospect: Pick<Prospect, 'analysis'>) =>
  prospect.analysis.status === 'pending' || prospect.analysis.status === 'checking' || prospect.analysis.status === 'scoring';

export const isTarget = (prospect: Pick<Prospect, 'analysis'>) => (prospect.analysis.score ?? 0) >= TARGET_SCORE;

/** The lead this business already is: imported from the Prospector, or the same phone or website in the CRM */
export const leadIdOf = (prospect: Pick<Prospect, 'importedLeadId' | 'existingLeadId'>) => prospect.importedLeadId ?? prospect.existingLeadId;
export const canImport = (prospect: Pick<Prospect, 'importedLeadId' | 'existingLeadId'>) => leadIdOf(prospect) === null;

export const searchLabel = (search: Pick<ProspectSearch, 'niche' | 'location'>) => `${search.niche} · ${search.location}`;

/** Businesses scored 4 or 5 */
export const targetCount = (search: Pick<ProspectSearch, 'scores'>) => search.scores['4'] + search.scores['5'];

export type ProspectFilter = 'targets' | 'all';
export type ProspectSort = 'score' | 'google';

/** The rows to show: the best targets first (or Google's order), and only 4–5 unless everything is asked for */
export function visibleProspects(prospects: readonly Prospect[], filter: ProspectFilter, sort: ProspectSort): Prospect[] {
  const shown = filter === 'targets' ? prospects.filter(isTarget) : [...prospects];
  return shown.sort((a, b) =>
    sort === 'google' ? a.position - b.position : (b.analysis.score ?? 0) - (a.analysis.score ?? 0) || a.position - b.position,
  );
}

/** Old-site markers as the server names them (server/src/prospector/signals.ts), in the app's words */
export function legacyLabel(marker: string): string {
  if (marker === 'table layout') return 'עימוד בטבלאות';
  if (marker === 'frames') return 'מסגרות (frames)';
  if (marker === '<marquee>') return 'טקסט רץ (marquee)';
  if (marker === '<font> tags') return 'תגיות font';
  if (marker === 'Internet Explorer fixes') return 'תיקונים לאינטרנט אקספלורר';
  const encoding = /^legacy encoding \((.+)\)$/.exec(marker);
  if (encoding) return `קידוד ישן (${encoding[1]})`;
  return marker;
}

export interface SiteFact {
  label: string;
  /** In the site's favour, against it, or neither */
  good: boolean | null;
  /** Technical names stay left to right */
  ltr?: boolean;
}

/** What the homepage check found, as short facts a seller can mention on the call */
export function siteFacts(signals: SiteSignals, now = new Date()): SiteFact[] {
  const facts: SiteFact[] = [];
  facts.push(signals.viewport ? { label: 'מותאם לנייד', good: true } : { label: 'לא מותאם לנייד', good: false });
  if (signals.mobileOverflow) facts.push({ label: 'גולל לצדדים בטלפון', good: false });
  facts.push(signals.https ? { label: 'HTTPS', good: true } : { label: 'בלי HTTPS', good: false });
  const load = signals.lcpMs ?? signals.loadMs;
  if (load !== null) facts.push({ label: `נטען ב-${(load / 1000).toFixed(1)} שניות`, good: load < 2500 ? true : load > 5000 ? false : null });
  if (signals.copyrightYear) facts.push({ label: `© ${signals.copyrightYear}`, good: now.getFullYear() - signals.copyrightYear >= 4 ? false : null, ltr: true });
  facts.push(signals.clickToCall || signals.whatsappButton
    ? { label: signals.whatsappButton && signals.clickToCall ? 'כפתורי חיוג ווואטסאפ' : signals.clickToCall ? 'כפתור חיוג' : 'כפתור וואטסאפ', good: true }
    : { label: 'אין כפתור חיוג או וואטסאפ', good: false });
  facts.push(signals.accessibilityStatement ? { label: 'הצהרת נגישות', good: true } : { label: 'אין הצהרת נגישות', good: false });
  for (const marker of signals.legacy) facts.push({ label: legacyLabel(marker), good: false, ltr: legacyLabel(marker) === marker });
  return facts;
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** "חדרי כושר · תל אביב", within the campaign field's 60 characters */
export function campaignFor(search: Pick<ProspectSearch, 'niche' | 'location'>): string {
  const full = searchLabel(search);
  return full.length <= 60 ? full : `${full.slice(0, 59).trimEnd()}…`;
}

/** What the Prospector found, as the lead's first timeline note. The same text the server writes. */
export function reportNote(prospect: Prospect, search: ProspectSearch): string {
  const { analysis } = prospect;
  const lines: string[] = [`נמצא במאתר הלידים: ${searchLabel(search)} (${dateFormat.format(Date.parse(search.createdAt))})`];
  if (analysis.score !== null) {
    lines.push(`ציון צורך: ${analysis.score}/5 (${SCORE_META[analysis.score].label})${analysis.verdict ? ` · ${analysis.verdict}` : ''}`);
  } else if (analysis.verdict) {
    lines.push(analysis.verdict);
  }
  for (const reason of analysis.reasons.slice(0, 4)) lines.push(`• ${reason}`);
  if (analysis.pitch) lines.push(`פתיחה לשיחה: ${analysis.pitch}`);
  lines.push('');
  const tech = analysis.signals?.tech.slice(0, 4).join(', ');
  lines.push(prospect.website ? `אתר: ${prospect.website}${tech ? ` (${tech})` : ''}` : 'אתר: אין');
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

/** The score and the opening line, for the lead's "how to talk to them" (shown on its Daily 10 card) */
export function approachFor(prospect: Prospect): string {
  const { analysis } = prospect;
  const head = analysis.score !== null ? `ציון צורך ${analysis.score}/5${analysis.verdict ? `: ${analysis.verdict}` : ''}` : analysis.verdict;
  return [head, analysis.pitch].filter(Boolean).join('\n').slice(0, 2000);
}

/** The lead a business becomes: at Cold Call, so it joins the Daily 10 pool, with the site analysis as its first note */
export function leadFromProspect(prospect: Prospect, search: ProspectSearch, now = new Date()): NewLead {
  const at = now.toISOString();
  return {
    id: createId(),
    name: prospect.name.slice(0, 120),
    contactName: '',
    phone: prospect.phone,
    email: prospect.analysis.signals?.emails[0] ?? '',
    website: prospect.website,
    campaign: campaignFor(search),
    approach: approachFor(prospect),
    method: 'call',
    stage: 'cold_call',
    stageChangedAt: at,
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { ...NO_DEAL },
    currency: 'ILS',
    activity: [],
    notes: [{ id: createId(), body: reportNote(prospect, search), createdAt: at }],
    createdAt: at,
    updatedAt: at,
  };
}
