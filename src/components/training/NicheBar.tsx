import { Check, LoaderCircle, RefreshCw, Sparkles, Store } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { repository } from '../../data/repository';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { count, ltr, NOUNS } from '../../lib/hebrew';
import { readLanguage } from '../../lib/language';
import { nicheKey } from '../../lib/niche';
import { useTimeline } from '../../store/timeline';
import { useTraining } from '../../store/training';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { inputBase } from '../ui/styles';

const OTHER = '__other';

/**
 * Which kind of business the answers are written for. A restaurant owner and a lawyer say "it's too expensive"
 * about different things: with a niche chosen, every card shows the answer the AI coach wrote for it.
 */
export function NicheBar({ activeCards }: { activeCards: number }) {
  const id = useId();
  const niche = useTraining((s) => s.niche);
  const niches = useTraining((s) => s.niches);
  const state = useTraining((s) => (s.niche ? s.tailored[nicheKey(s.niche)] : undefined));
  const setNiche = useTraining((s) => s.setNiche);
  const tailor = useTraining((s) => s.tailor);
  const coach = useTimeline((s) => Boolean(s.features?.coach));
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);

  const key = niche ? nicheKey(niche) : '';
  const options = [...(niches ?? [])];
  if (niche && !options.some((option) => option.key === key)) options.unshift({ key, label: niche, leads: 0, tailored: null });
  const data = state?.data ?? null;
  const tailoring = Boolean(data?.tailoring) || starting;
  const tailored = data?.variants.length ?? 0;
  const canTailor = repository.kind === 'remote' && coach;

  const choose = (value: string) => {
    if (value === OTHER) {
      setTyping(true);
      setDraft('');
      return;
    }
    setTyping(false);
    setNiche(options.find((option) => option.key === value)?.label ?? null);
  };

  const submitOther = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim().length < 2) return;
    setNiche(draft.trim());
    setTyping(false);
  };

  const start = async () => {
    setStarting(true);
    await tailor(readLanguage());
    setStarting(false);
  };

  return (
    <section aria-label="התאמה לסוג העסק" className="glass flex flex-col gap-3 rounded-[22px] px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={`${id}-niche`} className="flex items-center gap-2 text-[14px] font-semibold whitespace-nowrap">
          <Store className="size-4 text-[var(--st-zoom)]" aria-hidden />
          התשובות מותאמות ל:
        </label>
        <Select
          id={`${id}-niche`}
          value={typing ? OTHER : key}
          onChange={(event) => choose(event.target.value)}
          className="w-full min-w-0 sm:w-64"
          selectClassName="h-10"
        >
          <option value="">כל סוגי העסקים (כללי)</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
              {option.leads ? ` · ${count(option.leads, NOUNS.lead)}` : ''}
              {option.tailored ? ' ✓' : ''}
            </option>
          ))}
          <option value={OTHER}>סוג עסק אחר…</option>
        </Select>
        {typing && (
          <form onSubmit={submitOther} className="flex w-full gap-2 sm:w-auto">
            <input
              autoFocus
              dir="auto"
              aria-label="סוג העסק"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="למשל: מוסכים"
              maxLength={60}
              className={cn(inputBase, 'h-10 min-w-0 flex-1 px-3 text-base sm:w-44 sm:text-[14px]')}
            />
            <Button type="submit" size="sm" className="h-10" disabled={draft.trim().length < 2}>
              בחירה
            </Button>
          </form>
        )}
      </div>

      <div role="status" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-fg-muted lg:justify-end">
        {!niche ? (
          <span className="text-pretty">בחרו סוג עסק, וכל תשובה בחפיסה תדבר בשפה שלו: מסעדה שומעת דבר אחד, משרד עורכי דין דבר אחר.</span>
        ) : tailoring ? (
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-[var(--st-zoom)]" aria-hidden />
            {/* One run of text: in the flex row, loose pieces would be spaced apart */}
            <span>
              המאמן כותב תשובות ל<bdi>{niche}</bdi>. זה לוקח עד דקה, ואפשר להמשיך לתרגל בינתיים.
            </span>
          </span>
        ) : state?.status === 'loading' ? (
          <span className="flex items-center gap-2">
            <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
            טוען…
          </span>
        ) : tailored > 0 ? (
          <>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 shrink-0 text-[var(--st-won)]" aria-hidden />
              {tailored >= activeCards ? (
                <span>
                  {tailored === 1 ? 'הכרטיסייה מותאמת' : `כל ${tailored} הכרטיסיות מותאמות`} ל<bdi>{niche}</bdi>
                </span>
              ) : (
                <span>
                  {tailored} מתוך {activeCards} כרטיסיות מותאמות ל<bdi>{niche}</bdi>
                </span>
              )}
              {data?.updatedAt && <span className="text-fg-faint">· {formatRelative(data.updatedAt)}</span>}
            </span>
            {canTailor && (
              <Button size="sm" variant="ghost" onClick={() => void start()}>
                <RefreshCw className="size-4" aria-hidden />
                {tailored >= activeCards ? 'כתיבה מחדש' : 'השלמה'}
              </Button>
            )}
          </>
        ) : canTailor ? (
          <Button size="sm" variant="primary" onClick={() => void start()}>
            <Sparkles className="size-4" aria-hidden />
            <span>
              התאמת התשובות ל<bdi>{niche}</bdi>
            </span>
          </Button>
        ) : (
          <span className="text-pretty">
            {repository.kind === 'local'
              ? 'זו התצוגה המקדימה, בלי שרת, אז התשובות כלליות. התאמה לסוג עסק עובדת באפליקציה שמחוברת לשרת.'
              : `צריך את מאמן ה-AI: הגדירו ${ltr('AI_PROVIDER')} ו-${ltr('AI_API_KEY')} בשרת (בחינם: ${ltr('AI_PROVIDER=gemini')}).`}
          </span>
        )}
      </div>
    </section>
  );
}
