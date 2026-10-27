import {
  Check,
  CircleHelp,
  Clock,
  Copy,
  CornerDownRight,
  GraduationCap,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Lock,
  MessageCircle,
  PackageCheck,
  Quote,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { repository } from '../../data/repository';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/cn';
import { firstYearValue, hasDealTerms } from '../../lib/deal';
import { formatMoney, formatRelative } from '../../lib/format';
import { HEALTH } from '../../lib/health';
import { count, ltr, NOUNS } from '../../lib/hebrew';
import { LANGUAGES, readLanguage, saveLanguage } from '../../lib/language';
import { EASE_OUT } from '../../lib/motion';
import { nicheOf } from '../../lib/niche';
import { toneStyle } from '../../lib/stages';
import { isTranscribing } from '../../lib/timeline';
import { useLeadStore } from '../../store/leads';
import { useTimeline, type LeadProfile } from '../../store/timeline';
import { useTraining } from '../../store/training';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { CoachAnalysis, CoachingReport, CoachLanguage, CoachPricing, Lead, Likelihood } from '../../types';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';

const LIKELIHOOD: Record<Likelihood, { label: string; tone: string }> = {
  high: { label: 'סביר מאוד', tone: 'var(--st-lost)' },
  medium: { label: 'אפשרי', tone: 'var(--st-no-answer)' },
  low: { label: 'פחות סביר', tone: 'var(--st-cold)' },
};

const scriptText = (analysis: CoachAnalysis) =>
  [
    analysis.nextCall.goal && `מטרה: ${analysis.nextCall.goal}`,
    ...analysis.nextCall.script.map((line) => `${line.step}\n${line.say}`),
  ]
    .filter(Boolean)
    .join('\n\n');

/**
 * The AI sales coach: reads the lead's whole timeline on the server and returns what went right and wrong,
 * the mistakes to fix, the objections to answer, and a word-for-word script for the next call.
 */
export function CoachPanel({ lead, profile }: { lead: Lead; profile: LeadProfile | undefined }) {
  const features = useTimeline((s) => s.features);
  const run = useTimeline((s) => s.coachRuns[lead.id]);
  const runCoach = useTimeline((s) => s.runCoach);
  const [language, setLanguage] = useState<CoachLanguage>(readLanguage);

  const report = profile?.coaching ?? null;
  const entries = profile?.interactions.length ?? 0;
  const transcribing = profile?.media.filter(isTranscribing).length ?? 0;
  const running = run?.status === 'running';
  const enabled = Boolean(features?.coach);
  const newSince = report
    ? (profile?.interactions.filter((entry) => Date.parse(entry.updatedAt) > Date.parse(report.createdAt)).length ?? 0)
    : 0;

  const chooseLanguage = (value: CoachLanguage) => {
    setLanguage(value);
    saveLanguage(value);
  };

  const offMessage =
    repository.kind === 'local'
      ? 'האפליקציה לא מחוברת לשרת. המאמן פועל בשרת, עם מפתח AI (יש גם חינמי, של Gemini).'
      : `מאמן ה-AI כבוי. הגדירו ${ltr('AI_PROVIDER')} ו-${ltr('AI_API_KEY')} בקובץ ה-${ltr('.env')} של השרת (בחינם: ${ltr('AI_PROVIDER=gemini')} עם מפתח מ-${ltr('Google AI Studio')}), והפעילו אותו מחדש.`;

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="הפעלת המאמן"
        style={toneStyle('var(--st-zoom)')}
        className="relative overflow-hidden rounded-2xl bg-field px-4 py-4 ring-1 ring-line ring-inset sm:px-5"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -end-16 size-56 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--st-zoom) 30%, transparent), transparent)' }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h4 className="flex items-center gap-2 text-[15px] font-semibold">
              <Sparkles className="size-4 text-[var(--st-zoom)]" aria-hidden />
              מאמן המכירות (AI)
            </h4>
            <p className="mt-1 max-w-prose text-[13.5px] text-pretty text-fg-muted">
              {report ? (
                <>
                  {report.provider === 'sample' ? 'ניתוח לדוגמה' : `נותח ${formatRelative(report.createdAt)}`} על סמך{' '}
                  {count(report.interactionCount, NOUNS.entry)}
                  {/* The dot stays outside the model's left-to-right run, between it and the Hebrew */}
                  {report.provider !== 'sample' && (
                    <>
                      {' · '}
                      <bdi dir="ltr" className="whitespace-nowrap">
                        {report.model}
                      </bdi>
                    </>
                  )}
                  .
                </>
              ) : (
                `קורא את כל ציר הזמן${entries ? ` (${count(entries, NOUNS.entry)})` : ''} יחד עם הערות הגישה שלך, ואומר מה עבד, מה לא, ומה להגיד בשיחה הבאה.`
              )}
              {newSince > 0 && (
                <span className="font-medium text-fg">
                  {newSince === 1 ? ' מאז נוספה רשומה חדשה.' : ` מאז נוספו ${newSince} רשומות חדשות.`}
                </span>
              )}
            </p>
            {!enabled && features && <p className="mt-2 text-[13px] text-fg-faint">{offMessage}</p>}
            {enabled && transcribing > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-muted">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--st-answered)]" aria-hidden />
                {transcribing === 1 ? 'הקלטה אחת עדיין מתומללת' : `${transcribing} הקלטות עדיין מתומללות`}. כדאי לנתח כשהתמלול יגיע, כדי
                שהמאמן יקרא את כל השיחה.
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Segmented label="שפת הניתוח" value={language} options={LANGUAGES} onChange={chooseLanguage} className="h-10 sm:w-[244px]" />
            <Button
              variant="primary"
              disabled={!enabled || running}
              onClick={() => void runCoach(lead.id, language)}
              className="w-full sm:w-[244px]"
            >
              {report && report.provider !== 'sample' ? <RotateCcw className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {running ? 'מנתח…' : report && report.provider !== 'sample' ? 'ניתוח מחדש' : 'ניתוח העסקה'}
            </Button>
            <PracticeNiche lead={lead} />
          </div>
        </div>
        <p className="relative mt-3 flex items-center gap-1.5 text-[12px] text-fg-faint">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          הטלפון, האימייל והאתר של הליד אף פעם לא נשלחים ל-AI.
        </p>
      </section>

      {running ? (
        <Thinking entries={entries} />
      ) : run?.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[color-mix(in_oklab,var(--danger)_45%,transparent)] px-4 py-4">
          <p className="text-[13.5px]">
            <span className="font-medium text-danger">הניתוח לא הסתיים.</span> <span className="text-fg-muted">{run.error}</span>
          </p>
          {enabled && (
            <Button size="sm" onClick={() => void runCoach(lead.id, language)}>
              <RotateCcw className="size-4" aria-hidden />
              לנסות שוב
            </Button>
          )}
        </div>
      ) : null}

      {report && !running && <Report report={report} lead={lead} />}
      {!report && !running && run?.status !== 'error' && entries === 0 && enabled && (
        <p className="px-1 text-[13.5px] text-fg-muted">
          עדיין לא תועד כלום, אז המאמן יכין את השיחה הראשונה לפי הערות הגישה והקמפיין.
        </p>
      )}
    </div>
  );
}

function Thinking({ entries }: { entries: number }) {
  return (
    <div aria-live="polite" aria-busy="true" className="flex flex-col gap-4 rounded-2xl px-1 py-1">
      <p className="flex items-center gap-2 text-[14px] font-medium">
        <motion.span animate={{ rotate: [0, 18, -12, 0], scale: [1, 1.15, 1] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} className="flex">
          <Sparkles className="size-4 text-[var(--st-zoom)]" aria-hidden />
        </motion.span>
        {entries ? `קורא ${count(entries, NOUNS.entry)} מציר הזמן…` : 'קורא את פרטי הליד…'}
      </p>
      <div className="flex flex-col gap-2.5">
        {['92%', '78%', '85%', '60%'].map((width, index) => (
          <span key={index} className="shimmer block h-3 rounded-full" style={{ width, animationDelay: `${index * 0.15}s` }} />
        ))}
      </div>
      <p className="text-[12.5px] text-fg-faint">זה לוקח בדרך כלל 20 עד 60 שניות. אפשר להמשיך לעבוד, והתשובה תחכה כאן.</p>
    </div>
  );
}

function Report({ report, lead }: { report: CoachingReport; lead: Lead }) {
  const { analysis } = report;
  const health = HEALTH[analysis.dealHealth];
  const plan = analysis.actionPlan ?? [];
  const closing = analysis.closingObjections ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }} className="flex flex-col gap-5">
      <section aria-label="סיכום" className="flex flex-col gap-3">
        <span style={toneStyle(health.tone)} className="tone-chip inline-flex h-7 items-center gap-1.5 self-start rounded-full px-2.5 text-[12.5px] font-semibold">
          <health.icon className="size-3.5" strokeWidth={2.25} aria-hidden />
          {health.label}
        </span>
        <p dir="auto" className="text-[15.5px] leading-relaxed text-pretty">
          {analysis.summary}
        </p>
      </section>

      {plan.length > 0 && <ActionPlan plan={plan} />}

      <NextCall analysis={analysis} />

      {analysis.pricing && <Pricing pricing={analysis.pricing} lead={lead} />}

      {closing.length > 0 && <ClosingObjections items={closing} lead={lead} />}

      <div className="grid gap-5 md:grid-cols-2">
        <Bullets title="מה עבד" icon={ThumbsUp} tone="var(--st-won)" items={analysis.wentWell} />
        <Bullets title="מה לא עבד" icon={ThumbsDown} tone="var(--st-lost)" items={analysis.wentWrong} />
      </div>

      {analysis.mistakes.length > 0 && (
        <Section title="טעויות לתיקון" count={analysis.mistakes.length}>
          <ol className="flex flex-col gap-2.5">
            {analysis.mistakes.map((item, index) => (
              <li key={index} className="rounded-2xl bg-field px-4 py-3.5 ring-1 ring-line ring-inset">
                <p dir="auto" className="text-[14px] font-medium text-pretty">{item.mistake}</p>
                <p dir="auto" className="mt-1.5 flex gap-2 text-[13px] text-fg-muted">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
                  <span className="min-w-0 text-pretty">{item.evidence}</span>
                </p>
                <p dir="auto" className="mt-2 flex gap-2 text-[13.5px]">
                  <CornerDownRight className="flip-rtl mt-0.5 size-4 shrink-0 text-[var(--st-won)]" aria-hidden />
                  <span className="min-w-0 text-pretty">{item.fix}</span>
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {analysis.objections.length > 0 && (
        <Section title="התנגדויות שעלו" count={analysis.objections.length}>
          <ul className="flex flex-col gap-2.5">
            {analysis.objections.map((item, index) => {
              const open = item.status === 'open';
              return (
                <li key={index} className="rounded-2xl px-4 py-3.5 ring-1 ring-line ring-inset">
                  <div className="flex items-start gap-3">
                    <p dir="auto" className="min-w-0 flex-1 text-[14px] font-medium text-pretty">{item.objection}</p>
                    <span
                      style={toneStyle(open ? 'var(--st-no-answer)' : 'var(--st-won)')}
                      className="tone-chip shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                    >
                      {open ? 'פתוחה' : 'טופלה'}
                    </span>
                  </div>
                  <p dir="auto" style={toneStyle('var(--st-zoom)')} className="script-line mt-2 px-3 py-1.5 text-[13.5px] leading-relaxed text-pretty">
                    {item.response}
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Bullets title="מה עוד צריך לברר" icon={CircleHelp} tone="var(--st-cold)" items={analysis.openQuestions} />
        <Bullets title="טיפים לעסקה הזו" icon={Lightbulb} tone="var(--st-no-answer)" items={analysis.tips} />
      </div>
    </motion.div>
  );
}

/** The deal's to-do list, from today to the next commitment */
function ActionPlan({ plan }: { plan: NonNullable<CoachAnalysis['actionPlan']> }) {
  return (
    <Section title="תוכנית פעולה" icon={ListChecks} count={plan.length}>
      <ol className="flex flex-col gap-2">
        {plan.map((item, index) => (
          <li key={index} className="flex gap-3 rounded-2xl bg-field px-3.5 py-3 ring-1 ring-line ring-inset">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold tabular-nums ring-1 ring-line">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p dir="auto" className="text-[14.5px] font-medium text-pretty">
                {item.step}
              </p>
              {(item.when || item.why) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-muted">
                  {item.when && (
                    <span dir="auto" style={toneStyle('var(--st-zoom)')} className="tone-chip rounded-full px-2 py-0.5 text-[12px] font-semibold">
                      {item.when}
                    </span>
                  )}
                  {item.why && (
                    <span dir="auto" className="min-w-0 text-pretty">
                      {item.why}
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const PRICE_PARTS = [
  { field: 'setupFee', label: 'דמי הקמה', per: null },
  { field: 'monthlyRetainer', label: 'ריטיינר', per: 'לחודש' },
  { field: 'hostingYearly', label: 'דומיין ואחסון', per: 'לשנה' },
] as const;

/** What to quote: the three amounts, the floor, what's included, why, and how to say it */
function Pricing({ pricing, lead }: { pricing: CoachPricing; lead: Lead }) {
  const updateLead = useLeadStore((s) => s.updateLead);
  const section = useRef<HTMLElement>(null);
  const { currency } = pricing;
  // A deal that just closed takes the recommendation in one click; amounts already written are never replaced
  const canFill = lead.stage === 'closed' && !hasDealTerms(lead.deal);

  const fill = () => {
    updateLead(lead.id, {
      currency,
      deal: { setupFee: pricing.setupFee, monthlyRetainer: pricing.monthlyRetainer, hostingYearly: pricing.hostingYearly },
    });
    // The button hides rather than unmounts (inside a dialog that would throw focus to the dialog), so focus moves here
    section.current?.focus();
    toast.show({ message: 'סכומי העסקה נרשמו לפי ההמלצה', description: 'אפשר לשנות אותם בלשונית הפרטים.' });
  };

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="תמחור מומלץ"
      className="rounded-2xl px-4 py-4 ring-1 ring-[color-mix(in_oklab,var(--st-won)_30%,transparent)] ring-inset outline-none sm:px-5"
      style={{ background: 'color-mix(in oklab, var(--st-won) 6%, transparent)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--st-won)]">
          <Tag className="size-3.5" aria-hidden />
          תמחור מומלץ
        </h4>
        <Button size="sm" variant="primary" hidden={!canFill} onClick={fill}>
          <Check className="size-4" aria-hidden />
          מילוי סכומי העסקה
        </Button>
      </div>
      {/* What the numbers rest on, from the server rather than the AI's own words (older analyses don't say) */}
      {pricing.basedOnDeals !== undefined && (
        <p className="mt-1.5 text-[12.5px] text-pretty text-fg-muted">
          {pricing.basedOnDeals > 0
            ? `מבוסס על ${count(pricing.basedOnDeals, NOUNS.deal)} שלך, ומותאם לעסק הזה.`
            : 'הערכה כללית של ה-AI, לא מבוססת על העסקאות שלך: עוד אין עסקה סגורה עם סכומים במטבע הזה.'}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-3">
        {PRICE_PARTS.map((part) => {
          const value = pricing[part.field];
          return (
            <div key={part.field} className="min-w-0">
              <dt className="text-[12.5px] text-fg-muted">{part.label}</dt>
              <dd className="mt-1">
                <span className="block text-[19px] leading-tight tracking-[-0.015em] tabular-nums [font-weight:600] [font-stretch:92%] sm:text-[21px]">
                  {value > 0 ? formatMoney(value, currency) : '—'}
                </span>
                {part.per && value > 0 && <span className="text-[12px] text-fg-muted">{part.per}</span>}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 text-[13px] text-pretty text-fg-muted">
        בשנה הראשונה: <span className="font-semibold text-fg tabular-nums">{formatMoney(firstYearValue(pricing), currency)}</span>
        {pricing.walkAwaySetupFee > 0 && pricing.walkAwaySetupFee < pricing.setupFee && (
          <>
            {' · '}
            מחיר מינימום להקמה: <span className="font-semibold text-fg tabular-nums">{formatMoney(pricing.walkAwaySetupFee, currency)}</span>. מתחתיו מקצצים בהיקף, לא במחיר.
          </>
        )}
      </p>

      {pricing.scope.length > 0 && (
        <div className="mt-3.5">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted">
            <PackageCheck className="size-3.5" aria-hidden />
            מה כלול
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {pricing.scope.map((item, index) => (
              <li key={index} dir="auto" className="rounded-full bg-raised px-2.5 py-1 text-[12.5px] ring-1 ring-line">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pricing.rationale && (
        <p dir="auto" className="mt-3.5 text-[13.5px] leading-relaxed text-pretty text-fg-muted">
          {pricing.rationale}
        </p>
      )}

      {pricing.howToPresent && (
        <div className="mt-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-medium text-fg-muted">איך להציג את המחיר</p>
            <Button size="sm" variant="ghost" onClick={() => void copyText(pricing.howToPresent, { copied: 'הנוסח הועתק', failed: 'לא הצלחנו להעתיק.' })}>
              <Copy className="size-4" aria-hidden />
              העתקה
            </Button>
          </div>
          <p dir="auto" style={toneStyle('var(--st-won)')} className="script-line mt-1 px-3 py-1.5 text-[14px] leading-relaxed text-pretty">
            {pricing.howToPresent}
          </p>
        </div>
      )}

      {lead.stage !== 'closed' && <p className="mt-3 text-[12px] text-fg-faint">ההמלצה נשמרת עם הניתוח, ואפשר למלא איתה את סכומי העסקה כשהיא נסגרת.</p>}
    </section>
  );
}

/** Leaves the profile for objection practice, with the answers tailored to the lead's niche */
function practiceFor(lead: Lead) {
  const ui = useUi.getState();
  ui.setDetailsId(null);
  ui.setView('training');
  void useTraining.getState().practiceNiche(nicheOf(lead.campaign));
}

/** Practice before the call, answers tailored to the lead's kind of business */
function PracticeNiche({ lead }: { lead: Lead }) {
  const niche = nicheOf(lead.campaign);
  if (!niche) return null;
  return (
    <Button size="sm" variant="ghost" onClick={() => practiceFor(lead)} className="w-full sm:w-[244px]">
      <GraduationCap className="size-4" aria-hidden />
      <span className="truncate">
        תרגול התנגדויות ל<bdi>{niche}</bdi>
      </span>
    </Button>
  );
}

/** The objections to have answers ready for before asking this prospect to commit */
function ClosingObjections({ items, lead }: { items: NonNullable<CoachAnalysis['closingObjections']>; lead: Lead }) {
  const niche = nicheOf(lead.campaign);
  const title = lead.stage === 'zoom' ? 'התנגדויות צפויות בשיחת הסגירה' : lead.stage === 'cold_call' ? 'התנגדויות צפויות בשיחה הבאה' : 'התנגדויות צפויות';

  return (
    <Section title={title} icon={ShieldAlert} count={items.length}>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, index) => {
          const likely = LIKELIHOOD[item.likelihood] ?? LIKELIHOOD.medium;
          return (
            <li key={index} className="rounded-2xl px-4 py-3.5 ring-1 ring-line ring-inset">
              <div className="flex items-start gap-3">
                <p dir="auto" className="min-w-0 flex-1 text-[14px] font-medium text-pretty">
                  "{item.objection}"
                </p>
                <span style={toneStyle(likely.tone)} className="tone-chip shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold">
                  {likely.label}
                </span>
              </div>
              {item.why && (
                <p dir="auto" className="mt-1 text-[13px] text-pretty text-fg-muted">
                  {item.why}
                </p>
              )}
              <p dir="auto" style={toneStyle('var(--st-zoom)')} className="script-line mt-2 px-3 py-1.5 text-[13.5px] leading-relaxed text-pretty">
                {item.response}
              </p>
            </li>
          );
        })}
      </ul>
      {niche && (
        <Button size="sm" variant="ghost" className="-ms-2 mt-2" onClick={() => practiceFor(lead)}>
          <GraduationCap className="size-4" aria-hidden />
          <span>
            תרגול ההתנגדויות, מותאם ל<bdi>{niche}</bdi>
          </span>
        </Button>
      )}
    </Section>
  );
}

function NextCall({ analysis }: { analysis: CoachAnalysis }) {
  const { nextCall } = analysis;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <section aria-label="השיחה הבאה" style={toneStyle('var(--st-zoom)')} className="rounded-2xl bg-[color-mix(in_oklab,var(--st-zoom)_7%,transparent)] px-4 py-4 ring-1 ring-[color-mix(in_oklab,var(--st-zoom)_28%,transparent)] ring-inset sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-semibold text-[var(--st-zoom)]">השיחה הבאה</h4>
          <p dir="auto" className="mt-1 flex gap-2 text-[15px] font-semibold text-pretty">
            <Target className="mt-1 size-4 shrink-0 text-[var(--st-zoom)]" aria-hidden />
            <span className="min-w-0">{nextCall.goal}</span>
          </p>
          {nextCall.timing && (
            <p dir="auto" className="mt-1 flex gap-2 text-[13px] text-fg-muted">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 text-pretty">{nextCall.timing}</span>
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => void copyText(scriptText(analysis), { copied: 'התסריט הועתק', failed: 'לא הצלחנו להעתיק את התסריט.' }).then(setCopied)}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'הועתק' : 'העתקת התסריט'}
        </Button>
      </div>

      <ol className="mt-4 flex flex-col gap-3">
        {nextCall.script.map((line, index) => (
          <li key={index} className="flex gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold tabular-nums ring-1 ring-line">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p dir="auto" className="text-[12.5px] font-medium text-fg-muted">{line.step}</p>
              <p dir="auto" className="script-line mt-1 px-3 py-1.5 text-[14.5px] leading-relaxed text-pretty">
                {line.say}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {nextCall.fallbackMessage && (
        <div className="mt-4 rounded-xl bg-raised px-3.5 py-3 ring-1 ring-line">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted">
            <MessageCircle className="size-3.5 text-[var(--whatsapp)]" aria-hidden />
            אם לא עונים
          </p>
          <p dir="auto" className="mt-1.5 text-[14px] leading-relaxed text-pretty whitespace-pre-line">{nextCall.fallbackMessage}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button size="sm" variant="ghost" onClick={() => void copyText(nextCall.fallbackMessage, { copied: 'ההודעה הועתקה', failed: 'לא הצלחנו להעתיק את ההודעה.' })}>
              <Copy className="size-4" aria-hidden />
              העתקה
            </Button>
            <span className="text-[12px] text-fg-faint">טיוטה לשליחה בעצמכם. המערכת אף פעם לא שולחת כלום.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Section({ title, icon: Icon, count, children }: { title: string; icon?: LucideIcon; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h4 className="mb-2.5 flex items-baseline justify-between gap-3 text-[13px] font-medium text-fg-muted">
        <span className="flex items-center gap-2">
          {Icon && <Icon className="size-3.5 self-center" aria-hidden />}
          {title}
        </span>
        {count !== undefined && <span className="text-[12.5px] font-normal tabular-nums text-fg-faint">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

function Bullets({ title, icon: Icon, tone, items }: { title: string; icon: LucideIcon; tone: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2.5 text-[14px] leading-relaxed">
            <span style={toneStyle(tone)} className={cn('tone-chip mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full')}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span dir="auto" className="min-w-0 text-pretty">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
