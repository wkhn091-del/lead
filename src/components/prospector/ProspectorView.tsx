import { Camera, Gauge, Globe, Info, LoaderCircle, Lock, Radar, RotateCcw, Search, Sparkles } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { count, NOUNS } from '../../lib/hebrew';
import { isRunning, NICHE_IDEAS, searchLabel, targetCount } from '../../lib/prospects';
import { useProspector } from '../../store/prospector';
import { RESULT_LIMITS, type ProspectorStatus, type ProspectProvider, type ProspectSearch, type ProviderStatus, type ResultLimit } from '../../types';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { inputBase, inputSize, labelText } from '../ui/styles';
import { ImportBar } from './ImportBar';
import { ResultsPanel } from './ResultsPanel';

/**
 * "מאתר הלידים": finds local businesses by niche and area, checks each one's website and scores how much it
 * needs a new one (1–5), so the 4s and 5s can go straight into the Daily 10 pool.
 */
export function ProspectorView() {
  const { status, loadState, loadError, load, searches } = useProspector(
    useShallow((s) => ({ status: s.status, loadState: s.loadState, loadError: s.loadError, load: s.load, searches: s.searches })),
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!status) {
    return loadState === 'error' ? (
      <div className="glass flex flex-col items-center rounded-[22px] px-6 py-14 text-center">
        <h2 className="text-[17px] font-semibold">לא הצלחנו לטעון את מאתר הלידים</h2>
        <p className="mt-1.5 max-w-md text-[14px] text-fg-muted">{loadError}</p>
        <Button className="mt-5" onClick={() => void load()}>
          <RotateCcw className="size-4" aria-hidden />
          לנסות שוב
        </Button>
      </div>
    ) : (
      <div aria-busy="true" aria-label="טוען את מאתר הלידים" className="glass h-72 animate-pulse rounded-[28px]" />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-24 sm:gap-8">
      <SearchHero />
      {searches.length > 0 && <SearchHistory />}
      <ResultsPanel />
      <ImportBar />
    </div>
  );
}

function SearchHero() {
  const { status, start, starting } = useProspector(useShallow((s) => ({ status: s.status!, start: s.start, starting: s.starting })));
  const [niche, setNiche] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState<ResultLimit>(40);
  const [touched, setTouched] = useState(false);
  const id = useId();
  const enabled = status.enabled;
  const nicheError = touched && niche.trim().length < 2 ? 'כתבו תחום, למשל "מוסכים".' : null;
  const locationError = touched && location.trim().length < 2 ? 'כתבו אזור, למשל "עפולה".' : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!enabled || niche.trim().length < 2 || location.trim().length < 2) return;
    const started = await start({ niche: niche.trim(), location: location.trim(), limit, language: 'he' });
    if (started) setTouched(false);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="glass rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:gap-0">
        <div className="min-w-0 lg:pe-10">
          <p className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
            <Radar className="size-4 text-[var(--st-cold)]" aria-hidden />
            מאתר הלידים
          </p>
          <h2 id={`${id}-title`} className="mt-2.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[30px]">
            עסקים שצריכים אתר חדש, בתחום ובאזור שבחרת
          </h2>
          <p className="mt-2 max-w-prose text-[14px] text-pretty text-fg-muted">
            גוגל מוצא את העסקים, כל אתר נבדק ומקבל ציון צורך מ-1 עד 5, ואת ה-4 וה-5 מייבאים בלחיצה למאגר של העשירייה היומית.
          </p>

          <form noValidate onSubmit={(event) => void submit(event)} className="mt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={`${id}-niche`} className={cn(labelText, 'mb-1.5 block')}>
                  תחום
                </label>
                <input
                  id={`${id}-niche`}
                  value={niche}
                  onChange={(event) => setNiche(event.target.value)}
                  placeholder="למשל: מוסכים"
                  maxLength={60}
                  disabled={!enabled}
                  list={`${id}-ideas`}
                  autoComplete="off"
                  aria-invalid={nicheError ? true : undefined}
                  aria-describedby={nicheError ? `${id}-niche-error` : undefined}
                  className={cn(inputBase, inputSize, 'disabled:opacity-60')}
                />
                {nicheError && (
                  <p id={`${id}-niche-error`} className="mt-1.5 text-[12.5px] text-danger">
                    {nicheError}
                  </p>
                )}
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-location`} className={cn(labelText, 'mb-1.5 block')}>
                  אזור
                </label>
                <input
                  id={`${id}-location`}
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="למשל: עפולה"
                  maxLength={60}
                  disabled={!enabled}
                  autoComplete="off"
                  aria-invalid={locationError ? true : undefined}
                  aria-describedby={locationError ? `${id}-location-error` : undefined}
                  className={cn(inputBase, inputSize, 'disabled:opacity-60')}
                />
                {locationError && (
                  <p id={`${id}-location-error`} className="mt-1.5 text-[12.5px] text-danger">
                    {locationError}
                  </p>
                )}
              </div>
            </div>
            <datalist id={`${id}-ideas`}>
              {NICHE_IDEAS.map((idea) => (
                <option key={idea} value={idea} />
              ))}
            </datalist>

            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="רעיונות לתחומים">
              {NICHE_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setNiche(idea)}
                  className={cn(
                    'h-8 rounded-full px-3 text-[13px] ring-1 ring-inset transition-colors disabled:opacity-50',
                    niche === idea ? 'bg-raised font-medium text-fg ring-line-strong' : 'text-fg-muted ring-line hover:bg-field hover:text-fg',
                  )}
                >
                  {idea}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <p className={cn(labelText, 'mb-1.5')}>כמה עסקים</p>
                <Segmented<`${ResultLimit}`>
                  label="כמה עסקים לחפש"
                  value={`${limit}`}
                  options={RESULT_LIMITS.map((value) => ({ value: `${value}` as const, label: String(value) }))}
                  onChange={(value) => setLimit(Number(value) as ResultLimit)}
                  className="w-[11.5rem]"
                />
              </div>
              <Button type="submit" variant="primary" disabled={!enabled || starting} className="flex-1 sm:flex-none">
                {starting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
                {starting ? 'מתחיל…' : 'חיפוש עסקים'}
              </Button>
            </div>
          </form>

          {!enabled && (
            <p className="mt-4 flex gap-2 rounded-xl bg-[color-mix(in_oklab,var(--st-no-answer)_10%,transparent)] px-3.5 py-3 text-[13.5px] text-pretty ring-1 ring-[color-mix(in_oklab,var(--st-no-answer)_25%,transparent)] ring-inset">
              <Info className="mt-0.5 size-4 shrink-0 text-[var(--st-no-answer)]" aria-hidden />
              {status.reason}
            </p>
          )}
        </div>

        <aside className="min-w-0 lg:border-s lg:border-line lg:ps-10">
          <p className="text-[13px] font-medium text-fg-muted">איך הציון נקבע</p>
          <ol className="mt-3 flex flex-col gap-3 text-[14px]">
            <Step icon={Globe} title="גוגל מוצא את העסקים">
              שם, טלפון והאתר שבכרטיס של כל עסק בתחום ובאזור.
            </Step>
            <Step icon={Gauge} title="כל אתר נבדק">
              התאמה לנייד, מהירות, טכנולוגיה, שנת זכויות היוצרים, הצהרת נגישות וכפתור חיוג.
            </Step>
            <Step icon={Sparkles} title="ציון צורך מ-1 עד 5">
              5: אין אתר או שהוא לא עובד. 4: מיושן מאוד. 1: אתר פרימיום, פחות מתאים.
            </Step>
          </ol>
          {status.enabled && <Providers status={status} />}
          {status.enabled && (
            <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-faint">
              <span className="flex items-center gap-1">
                <Sparkles className="size-3.5" aria-hidden />
                {status.ai ? 'ציון מה-AI' : 'ציון לפי סימני האתר'}
              </span>
              {status.browser && (
                <span className="flex items-center gap-1">
                  <Camera className="size-3.5" aria-hidden />
                  צילום מסך בטלפון
                </span>
              )}
              <span>תוצאות נשמרות {count(status.retentionDays, NOUNS.day)}</span>
            </p>
          )}
          <p className="mt-2.5 flex gap-1.5 text-[12px] text-pretty text-fg-faint">
            <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
            קריאה בלבד: חיפוש בגוגל וביקור אחד בדף הבית של כל עסק. אף עסק לא מקבל הודעה, וטלפונים ואימיילים לא נשלחים ל-AI.
          </p>
        </aside>
      </div>
    </section>
  );
}

const PROVIDER_LABEL: Record<ProspectProvider, string> = { google: 'Google Places', serpapi: 'SerpApi' };
const STATE_TONE: Record<ProviderStatus['state'], string> = {
  ready: 'var(--st-won)',
  exhausted: 'var(--st-no-answer)',
  resting: 'var(--st-lost)',
};
const renewDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });

/**
 * Who searches, and how it's going: SerpApi's searches left this month, and the backup that takes over when the
 * first choice is out of searches or down. Each state has its words next to its dot.
 */
function Providers({ status }: { status: Extract<ProspectorStatus, { enabled: true }> }) {
  const providers: ProviderStatus[] = status.providers?.length
    ? status.providers
    : [{ name: status.provider, role: 'primary', state: 'ready', searchesLeft: null, searchesPerMonth: null, renews: null, note: null }];
  const [primary] = providers;
  const backup = providers.find((item) => item.role === 'backup');

  // Each line is about its own provider: the first choice says why it's out, and the backup that it took over
  const describe = (item: ProviderStatus): string => {
    if (item.state === 'exhausted') {
      return `נגמרו החיפושים החודש${item.renews ? `, מתחדשים ב-${renewDate.format(new Date(item.renews))}` : ''}`;
    }
    if (item.state === 'resting') return item.role === 'primary' && backup ? 'לא זמין כרגע' : 'לא זמין כרגע, ננסה שוב בעוד כמה דקות';
    if (item.role === 'backup' && primary.state !== 'ready') return `מחפש עכשיו, במקום ${PROVIDER_LABEL[primary.name]}`;
    if (item.searchesLeft !== null) {
      const left = item.searchesLeft === 1 ? 'נשארה בקשה אחת' : `נשארו ${count(item.searchesLeft, NOUNS.request)}`;
      return `${left}${item.searchesPerMonth ? ` מתוך ${item.searchesPerMonth.toLocaleString('he-IL')}` : ''} החודש`;
    }
    return item.role === 'backup' ? `גיבוי: מחפש כש-${PROVIDER_LABEL[primary.name]} לא יכול` : 'מחפש את העסקים';
  };

  return (
    <ul aria-label="ספקי החיפוש" className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
      {providers.map((item) => (
        <li
          key={item.name}
          className="flex items-baseline gap-2"
          title={item.name === 'serpapi' ? 'כל עמוד של 20 עסקים הוא בקשה אחת: חיפוש של 60 עסקים הוא 3 בקשות.' : undefined}
        >
          <span aria-hidden className="size-1.5 shrink-0 translate-y-[-1px] self-center rounded-full" style={{ background: STATE_TONE[item.state] }} />
          <span className="font-medium whitespace-nowrap text-fg-muted">{PROVIDER_LABEL[item.name]}</span>
          <span className="min-w-0 text-pretty text-fg-faint">{describe(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function Step({ icon: Icon, title, children }: { icon: typeof Globe; title: string; children: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-field text-fg-muted ring-1 ring-line ring-inset">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-[13px] text-pretty text-fg-muted">{children}</span>
      </span>
    </li>
  );
}

/** Recent searches; the one on screen is marked */
function SearchHistory() {
  const { searches, currentId, open } = useProspector(
    useShallow((s) => ({ searches: s.searches, currentId: s.current?.search.id ?? null, open: s.open })),
  );
  return (
    <nav aria-label="חיפושים אחרונים">
      <h2 className="mb-2.5 px-1 text-[13px] font-medium text-fg-muted">חיפושים אחרונים</h2>
      <ul className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
        {searches.map((search) => (
          <li key={search.id} className="snap-start">
            <HistoryCard search={search} active={search.id === currentId} onOpen={() => void open(search.id)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HistoryCard({ search, active, onOpen }: { search: ProspectSearch; active: boolean; onOpen: () => void }) {
  const running = isRunning(search);
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={cn(
        'flex w-[15.5rem] flex-col gap-1 rounded-2xl px-4 py-3 text-start ring-1 ring-inset transition-colors',
        active ? 'bg-raised ring-line-strong shadow-[0_1px_2px_var(--shadow-soft)]' : 'bg-field ring-line hover:bg-field-hover',
      )}
    >
      <span className="flex items-center gap-2">
        <span dir="auto" className="truncate text-[14.5px] font-semibold">
          {searchLabel(search)}
        </span>
        {search.demo && <span className="shrink-0 text-[11.5px] font-medium text-[var(--st-zoom)]">דוגמה</span>}
      </span>
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        {running ? (
          <>
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {search.status === 'discovering' ? 'מחפש…' : `בודק ${search.checked}/${search.total}`}
          </>
        ) : search.status === 'failed' ? (
          <span className="text-danger">החיפוש נכשל</span>
        ) : (
          <>
            {count(search.total, NOUNS.business)}
            <span className="text-fg-faint" aria-hidden>
              ·
            </span>
            <span className="font-medium text-[var(--st-won)]">{targetCount(search)} עם 4-5</span>
          </>
        )}
      </span>
      <span className="text-[12px] text-fg-faint">{formatRelative(search.createdAt)}</span>
    </button>
  );
}
