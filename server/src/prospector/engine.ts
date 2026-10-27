import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoachProvider } from '../coach/providers.js';
import type { MediaStorage } from '../media/storage.js';
import type { Stores } from '../stores/types.js';
import type { SiteRenderer } from './browser.js';
import { buildQuery, DiscoveryError } from './discovery.js';
import type { Discovery } from './fallback.js';
import { LeadMatcher } from './importer.js';
import { classifyNetworkError, decodeHtml, fetchPage, FetchFailure, type FetchedPage, type FetchOptions } from './net.js';
import { ASSESSMENT_JSON_SCHEMA, assessmentPrompt, assessmentSystemPrompt, finalScore, notMobileFriendly, ruleScore, SiteAssessment } from './score.js';
import { extractSignals, parsePage } from './signals.js';
import { cleanWebsite, domainOf, failureVerdict, notAWebsite, responseVerdict, type SiteVerdict } from './site.js';
import {
  emptyAnalysis,
  type NewProspect,
  type ProspectAnalysis,
  type ProspectRecord,
  type ProspectSearchRecord,
  type SiteSignals,
} from './types.js';

export interface ProspectorSettings {
  businessContext: string;
  countryCode: string;
  /** A site analyzed this recently (by any search) is reused rather than checked again */
  reuseDays: number;
  /** Searches and their results are deleted after this many days; imported leads stay */
  retentionDays: number;
  fetch: Omit<FetchOptions, 'signal' | 'timeoutMs'>;
  concurrency: { fetch: number; render: number; ai: number };
}

export interface ProspectorDeps {
  stores: Stores;
  storage: MediaStorage;
  /** The search providers, first choice first (see fallback.ts) */
  discovery: Discovery;
  /** Null scores working sites by the rules alone */
  coach: CoachProvider | null;
  /** Null without PROSPECTOR_CHROME_PATH: no screenshots, the plain download only */
  renderer: SiteRenderer | null;
  settings: ProspectorSettings;
  clock: () => Date;
}

export interface SearchInput {
  niche: string;
  location: string;
  limit: number;
  language: 'he' | 'en';
}

/** Runs at most `max` tasks at a time, the rest in the order they arrive */
class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** Failures worth one more try: the network, not the site */
const TRANSIENT = new Set(['timeout', 'reset', 'dns-temporary', 'other']);

/** What checking a website found */
interface SiteCheck {
  /** Set when the site is down, a placeholder, or turned the check away */
  verdict: SiteVerdict | null;
  signals: SiteSignals | null;
  screenshot: Buffer | null;
  /** Neither the download nor the browser got through, for a reason that says nothing about the site */
  unreachable: string | null;
}

const PITCH = {
  none: 'ראיתי בגוגל שאין לעסק אתר משלו. אני בונה אתרים לעסקים, ואשמח להראות לכם בכמה דקות איך אתר שלכם יכול להיראות ולהביא פניות.',
  social: 'ראיתי שהקישור בכרטיס הגוגל שלכם מוביל רק לעמוד ברשת חברתית. אני בונה אתרים לעסקים, ואשמח להראות לכם איך אתר משלכם יכול להביא פניות ישר מגוגל.',
  broken: 'רציתי לעדכן שהאתר שמופיע בכרטיס הגוגל שלכם לא נפתח כרגע. אני בונה אתרים לעסקים, ואשמח לעזור להחזיר אתכם לאוויר עם אתר עדכני.',
};

const RULE_VERDICT: Record<number, string> = {
  4: 'אתר מיושן שצריך החלפה',
  3: 'אתר שעובד, אבל בסיסי ומיושן',
  2: 'אתר סביר עם כמה חוסרים',
  1: 'אתר עדכני ומושקע',
};

/**
 * Searches run in the background: find the businesses, then check each website (several at a time) and score
 * it. Progress is saved as it goes, so the app can show results while the rest are still being checked, and a
 * search the server was in the middle of picks up again after a restart.
 */
export class ProspectorEngine {
  private readonly runs = new Map<string, AbortController>();
  private readonly fetchSlots: Limiter;
  private readonly renderSlots: Limiter;
  private readonly aiSlots: Limiter;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ProspectorDeps) {
    this.fetchSlots = new Limiter(deps.settings.concurrency.fetch);
    this.renderSlots = new Limiter(deps.settings.concurrency.render);
    this.aiSlots = new Limiter(deps.settings.concurrency.ai);
  }

  get providerName() {
    return this.deps.discovery.primary;
  }
  /** The provider that takes over when the first can't search, if there is one */
  get backupName() {
    return this.deps.discovery.backup;
  }
  /** Each provider's state: searches left, out of searches, resting after a failure */
  providerStatus() {
    return this.deps.discovery.status();
  }
  get browser() {
    return this.deps.renderer !== null;
  }
  get ai() {
    return this.deps.coach !== null;
  }
  get retentionDays() {
    return this.deps.settings.retentionDays;
  }

  isRunning(searchId: string) {
    return this.runs.has(searchId);
  }

  /** Saves the search and starts it in the background */
  async start(input: SearchInput): Promise<ProspectSearchRecord> {
    const search = await this.deps.stores.prospector.createSearch({
      id: randomUUID(),
      niche: input.niche,
      location: input.location,
      query: buildQuery(input.niche, input.location),
      // The first choice for now; the search records who actually found the businesses
      provider: this.deps.discovery.primary,
      fallbackFrom: null,
      notice: null,
      limit: input.limit,
      language: input.language,
      status: 'discovering',
      error: null,
      found: 0,
      finishedAt: null,
    });
    this.launch(search);
    return search;
  }

  /** Stops a running search. What was checked stays; the rest is marked skipped. */
  async cancel(searchId: string): Promise<ProspectSearchRecord | null> {
    const run = this.runs.get(searchId);
    run?.abort(new Error('cancelled'));
    const search = await this.deps.stores.prospector.getSearch(searchId);
    if (!search) return null;
    if (search.status === 'discovering' || search.status === 'analyzing') {
      await this.skipUnfinished(searchId);
      return this.deps.stores.prospector.updateSearch(searchId, { status: 'cancelled', finishedAt: this.deps.clock() });
    }
    return search;
  }

  /** Deletes a search, its results and their screenshots. Leads imported from it stay. */
  async remove(searchId: string): Promise<void> {
    this.runs.get(searchId)?.abort(new Error('removed'));
    const keys = await this.deps.stores.prospector.removeSearch(searchId);
    if (keys.length) await this.deps.storage.remove(keys).catch((error: unknown) => console.error("Some Prospector screenshots couldn't be deleted:", error));
  }

  /** Checks one business's website again, now */
  async reanalyze(prospect: ProspectRecord): Promise<void> {
    const search = await this.deps.stores.prospector.getSearch(prospect.searchId);
    if (!search) return;
    const controller = new AbortController();
    await this.deps.stores.prospector.setAnalysis(prospect.id, { ...emptyAnalysis() });
    void this.analyze({ ...prospect, analysis: emptyAnalysis() }, search, controller.signal, { reuse: false }).catch((error: unknown) =>
      console.error('Prospector re-check failed:', error),
    );
  }

  /** Picks up searches the server was working on when it stopped, and starts the daily clean-up */
  async resume(): Promise<void> {
    for (const search of await this.deps.stores.prospector.unfinishedSearches()) this.launch(search);
    await this.cleanup();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const run of this.runs.values()) run.abort(new Error('server stopping'));
    await this.deps.renderer?.close();
  }

  /** Deletes searches older than the retention period (Google's terms only let us keep place ids) */
  async cleanup(): Promise<void> {
    try {
      const before = new Date(this.deps.clock().getTime() - this.deps.settings.retentionDays * DAY);
      for (const search of await this.deps.stores.prospector.searchesBefore(before)) {
        if (!this.runs.has(search.id)) await this.remove(search.id);
      }
    } catch (error) {
      console.error('Prospector clean-up failed:', error);
    }
  }

  private launch(search: ProspectSearchRecord) {
    if (this.runs.has(search.id)) return;
    const controller = new AbortController();
    this.runs.set(search.id, controller);
    void this.run(search, controller.signal)
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof DiscoveryError ? error.message : 'החיפוש נכשל בשרת. נסו שוב.';
        if (!(error instanceof DiscoveryError)) console.error('Prospector search failed:', error);
        await this.deps.stores.prospector.updateSearch(search.id, { status: 'failed', error: message, finishedAt: this.deps.clock() }).catch(() => {});
      })
      .finally(() => this.runs.delete(search.id));
  }

  private async run(search: ProspectSearchRecord, signal: AbortSignal) {
    const store = this.deps.stores.prospector;
    let prospects = await store.listProspects(search.id);
    if (!prospects.length) {
      prospects = await this.discover(search, signal);
      if (signal.aborted) return;
    }
    await store.updateSearch(search.id, { status: 'analyzing', found: prospects.length });

    // The same website twice (branches of a chain) is checked once and shared.
    const byDomain = new Map<string, ProspectRecord[]>();
    const singles: ProspectRecord[] = [];
    for (const prospect of prospects) {
      if (prospect.analysis.status === 'done' || prospect.analysis.status === 'skipped') continue;
      if (prospect.domain && !notAWebsite(prospect.website)) byDomain.set(prospect.domain, [...(byDomain.get(prospect.domain) ?? []), prospect]);
      else singles.push(prospect);
    }
    const work = [
      ...singles.map((prospect) => this.analyze(prospect, search, signal, { reuse: true })),
      ...[...byDomain.values()].map(async ([first, ...rest]) => {
        const analysis = await this.analyze(first, search, signal, { reuse: true });
        for (const other of rest) {
          if (signal.aborted) return;
          if (analysis?.status === 'done') await this.copyAnalysis(other, first.id, analysis, search.id);
          else await this.analyze(other, search, signal, { reuse: true });
        }
      }),
    ];
    await Promise.allSettled(work);
    if (signal.aborted) return;
    await store.updateSearch(search.id, { status: 'done', finishedAt: this.deps.clock() });
  }

  /** Finds the businesses and saves them, marking any that are already leads */
  private async discover(search: ProspectSearchRecord, signal: AbortSignal): Promise<ProspectRecord[]> {
    const { places, provider, fallbackFrom, notice } = await this.deps.discovery.search(search.query, search.limit, signal);
    if (signal.aborted) return [];
    if (provider !== search.provider || fallbackFrom || notice) {
      await this.deps.stores.prospector.updateSearch(search.id, { provider, fallbackFrom, notice });
    }
    const matcher = new LeadMatcher(await this.deps.stores.leads.list(), this.deps.settings.countryCode);
    const records: NewProspect[] = places.map((place, position) => {
      const website = cleanWebsite(place.website);
      return {
        ...place,
        website,
        id: randomUUID(),
        searchId: search.id,
        position,
        domain: website ? domainOf(website) : '',
        existingLeadId: matcher.find({ ...place, website }),
        importedLeadId: null,
        importedAt: null,
        analysis: emptyAnalysis(),
      };
    });
    await this.deps.stores.prospector.addProspects(records);
    return this.deps.stores.prospector.listProspects(search.id);
  }

  private async skipUnfinished(searchId: string) {
    const store = this.deps.stores.prospector;
    for (const prospect of await store.listProspects(searchId)) {
      const { status } = prospect.analysis;
      if (status === 'pending' || status === 'checking' || status === 'scoring') {
        await store.setAnalysis(prospect.id, { ...prospect.analysis, status: 'skipped', error: 'החיפוש נעצר לפני שהאתר נבדק' });
      }
    }
  }

  private async copyAnalysis(target: ProspectRecord, sourceId: string, analysis: ProspectAnalysis, searchId: string) {
    let screenshotKey: string | null = null;
    if (analysis.screenshotKey) {
      screenshotKey = await this.copyScreenshot(analysis.screenshotKey, searchId, target.id).catch(() => null);
    }
    await this.deps.stores.prospector.setAnalysis(target.id, { ...analysis, screenshotKey, reusedFrom: sourceId });
  }

  private async copyScreenshot(key: string, searchId: string, prospectId: string): Promise<string> {
    const newKey = `prospector/${searchId}/${prospectId}.jpg`;
    if (newKey === key) return key;
    const folder = await mkdtemp(join(tmpdir(), 'omek-shot-'));
    try {
      const temp = join(folder, 'shot.jpg');
      await this.deps.storage.withLocalFile(key, (path) => copyFile(path, temp));
      await this.deps.storage.save(newKey, temp, 'image/jpeg');
      return newKey;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** Checks one business's website and scores it. Returns the saved analysis (null when the prospect is gone). */
  private async analyze(prospect: ProspectRecord, search: ProspectSearchRecord, signal: AbortSignal, options: { reuse: boolean }): Promise<ProspectAnalysis | null> {
    const store = this.deps.stores.prospector;
    const now = () => this.deps.clock();
    // Nothing is written once the search is stopped, so a late result can't undo "skipped".
    const save = async (analysis: ProspectAnalysis) => (signal.aborted ? null : ((await store.setAnalysis(prospect.id, analysis))?.analysis ?? null));
    const decided = (state: 'none' | 'social' | 'broken', reason: string): ProspectAnalysis => ({
      ...emptyAnalysis(),
      status: 'done',
      siteState: state,
      score: 5,
      ruleScore: 5,
      scoredBy: 'rules',
      verdict: state === 'none' ? 'אין לעסק אתר' : reason,
      reasons: [state === 'none' ? 'אין אתר בכרטיס הגוגל של העסק, רק טלפון וכתובת' : reason],
      pitch: PITCH[state],
      confidence: 'high',
      analyzedAt: now(),
    });

    try {
      if (!prospect.website) return await save(decided('none', ''));
      const elsewhere = notAWebsite(prospect.website);
      if (elsewhere) return await save(decided(elsewhere.state === 'broken' ? 'broken' : 'social', elsewhere.reason));

      if (options.reuse && prospect.domain) {
        const since = new Date(now().getTime() - this.deps.settings.reuseDays * DAY);
        const recent = await store.recentAnalysis(prospect.domain, since, prospect.id);
        if (recent) {
          await this.copyAnalysis(prospect, recent.id, recent.analysis, prospect.searchId);
          return (await store.getProspect(prospect.id))?.analysis ?? null;
        }
      }

      await save({ ...emptyAnalysis(), status: 'checking' });
      const check = await this.checkSite(prospect, signal);
      if (signal.aborted) return null;
      if (check.unreachable) {
        return await save({ ...emptyAnalysis(), status: 'failed', error: check.unreachable, analyzedAt: now() });
      }
      if (check.verdict && (check.verdict.state === 'broken' || check.verdict.state === 'social')) {
        return await save(decided(check.verdict.state, check.verdict.reason));
      }
      if (!check.signals) {
        // Blocked, with nothing to judge
        return await save({
          ...emptyAnalysis(),
          status: 'done',
          siteState: 'blocked',
          verdict: check.verdict?.reason ?? 'לא הצלחנו לקרוא את האתר',
          reasons: [check.verdict?.reason ?? 'לא הצלחנו לקרוא את האתר'],
          confidence: 'low',
          analyzedAt: now(),
        });
      }

      const signals = check.signals;
      const rule = ruleScore(signals, now());
      const screenshotKey = check.screenshot ? await this.saveScreenshot(search.id, prospect.id, check.screenshot).catch(() => null) : null;
      const base: ProspectAnalysis = {
        ...emptyAnalysis(),
        status: 'done',
        siteState: 'ok',
        score: rule.score,
        ruleScore: rule.score,
        scoredBy: 'rules',
        verdict: RULE_VERDICT[rule.score],
        reasons: rule.reasons,
        pitch: rulePitch(rule.reasons, signals),
        confidence: signals.rendered ? 'medium' : 'low',
        signals,
        screenshotKey,
        analyzedAt: now(),
      };
      const coach = this.deps.coach;
      if (!coach) return await save(base);

      await save({ ...base, status: 'scoring', score: null, analyzedAt: null });
      try {
        const answer = await this.aiSlots.run(() =>
          coach.complete({
            system: assessmentSystemPrompt(search.language, this.deps.settings.businessContext),
            prompt: assessmentPrompt(prospect, signals, rule, Boolean(check.screenshot)),
            schema: ASSESSMENT_JSON_SCHEMA,
            maxTokens: 1500,
            images: check.screenshot ? [{ mediaType: 'image/jpeg', data: check.screenshot.toString('base64') }] : undefined,
          }),
        );
        if (signal.aborted) return null;
        const assessment = SiteAssessment.safeParse(answer);
        if (!assessment.success) throw new Error('The AI answered in an unexpected format.');
        return await save({
          ...base,
          score: finalScore(assessment.data, signals),
          scoredBy: 'ai',
          verdict: assessment.data.verdict,
          reasons: assessment.data.reasons.slice(0, 4),
          pitch: assessment.data.pitch,
          confidence: assessment.data.confidence,
          analyzedAt: now(),
        });
      } catch (error) {
        if (signal.aborted) return null;
        console.error(`Prospector AI scoring failed for ${prospect.domain}:`, error instanceof Error ? error.message : error);
        return await save({ ...base, error: 'ה-AI לא היה זמין, אז הציון לפי סימני האתר בלבד.' });
      }
    } catch (error) {
      if (signal.aborted) return null;
      console.error(`Prospector check failed for ${prospect.website}:`, error);
      return await save({ ...emptyAnalysis(), status: 'failed', error: 'הבדיקה נכשלה בשרת. אפשר לנסות שוב.', analyzedAt: now() }).catch(() => null);
    }
  }

  private async saveScreenshot(searchId: string, prospectId: string, image: Buffer): Promise<string> {
    const key = `prospector/${searchId}/${prospectId}.jpg`;
    const folder = await mkdtemp(join(tmpdir(), 'omek-shot-'));
    try {
      const temp = join(folder, 'shot.jpg');
      await writeFile(temp, image);
      await this.deps.storage.save(key, temp, 'image/jpeg');
      return key;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** Downloads the homepage (one retry for network hiccups), then opens it in the browser when that's on */
  private async checkSite(prospect: ProspectRecord, signal: AbortSignal): Promise<SiteCheck> {
    const { settings, renderer } = this.deps;
    let page: FetchedPage | null = null;
    let failure: FetchFailure | null = null;
    for (let attempt = 0; attempt < 2 && !page; attempt++) {
      try {
        page = await this.fetchSlots.run(() => fetchPage(prospect.website, { ...settings.fetch, timeoutMs: attempt ? 22_000 : 15_000, signal, stopAt: isElsewhere }));
      } catch (error) {
        failure = classifyNetworkError(error);
        if (failure.kind === 'aborted') throw failure;
        if (failure.kind === 'tls-chain') {
          // The server leaves out part of its certificate chain. Browsers usually cope, so read it anyway.
          try {
            page = await this.fetchSlots.run(() =>
              fetchPage(prospect.website, { ...settings.fetch, timeoutMs: 15_000, signal, skipCertificateCheck: true, stopAt: isElsewhere }),
            );
          } catch (inner) {
            failure = classifyNetworkError(inner);
          }
          break;
        }
        if (!TRANSIENT.has(failure.kind)) break;
      }
    }

    if (!page) {
      const verdict = failure ? failureVerdict(failure) : null;
      if (verdict) return { verdict, signals: null, screenshot: null, unreachable: null };
      return { verdict: null, signals: null, screenshot: null, unreachable: 'לא הצלחנו להגיע לאתר כרגע (תקלת רשת). אפשר לנסות שוב.' };
    }

    const fetched = page;
    const now = this.deps.clock();
    const { html, charset } = decodeHtml(fetched.body, fetched.contentType);
    const parsed = parsePage(html);
    const verdict = responseVerdict(fetched, html, parsed.text);
    if (verdict?.state === 'broken' || verdict?.state === 'social') return { verdict, signals: null, screenshot: null, unreachable: null };

    let signals: SiteSignals | null =
      verdict?.state === 'blocked'
        ? null
        : extractSignals(
            { html, finalUrl: fetched.finalUrl, status: fetched.status, charset, responseMs: fetched.ttfbMs, loadMs: fetched.totalMs, bytes: fetched.body.length, now },
            parsed,
          );
    if (!renderer) return { verdict, signals, screenshot: null, unreachable: null };

    try {
      const render = await this.renderSlots.run(() => renderer.render(fetched.finalUrl, signal));
      // The plain download was turned away or came back nearly empty: judge the page the browser built.
      if (!signals || parsed.text.length < 200) {
        const rendered = parsePage(render.html);
        if (rendered.text.length >= 200 && (render.status === null || render.status < 400)) {
          signals = extractSignals(
            { html: render.html, finalUrl: render.finalUrl, status: render.status ?? 200, charset: 'utf-8', responseMs: fetched.ttfbMs, loadMs: fetched.totalMs, bytes: Buffer.byteLength(render.html), now },
            rendered,
          );
        }
      }
      if (!signals) return { verdict, signals: null, screenshot: null, unreachable: null };
      signals = {
        ...signals,
        rendered: true,
        mobileOverflow: render.mobileOverflow,
        renderMs: render.renderMs,
        lcpMs: render.lcpMs,
        consoleErrors: render.consoleErrors,
        text: signals.text.length >= 200 ? signals.text : render.text || signals.text,
      };
      return { verdict: null, signals, screenshot: render.screenshot, unreachable: null };
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn(`The browser couldn't open ${fetched.finalUrl}:`, error instanceof Error ? error.message : error);
      return { verdict, signals, screenshot: null, unreachable: null };
    }
  }
}

/** A redirect to a Facebook page, a directory listing and the like ends the check there */
const isElsewhere = (url: URL) => notAWebsite(url.toString()) !== null;

/** An opening line without the AI, built on the first thing the rules found */
function rulePitch(reasons: string[], signals: SiteSignals): string {
  if (!notMobileFriendly(signals) && reasons[0]?.startsWith('אתר עדכני')) return '';
  // The finding itself, without the explanation some reasons add after it
  const finding = reasons[0] ? `, למשל: ${reasons[0].split('. ')[0]}` : '';
  return `עברתי על האתר שלכם וראיתי כמה דברים שאפשר לשפר${finding}. אני בונה אתרים לעסקים, ואשמח להכין לכם הדמיה של דף הבית, בחינם, כדי שתראו איך זה יכול להיראות.`;
}
