import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarCheck, ChevronDown, Lightbulb, MessageSquareQuote, Quote, RotateCcw, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../lib/cn';
import { count as countOf, NOUNS } from '../../lib/hebrew';
import { EASE_OUT } from '../../lib/motion';
import { CATEGORY_LABEL, comesBack, GRADES, nextStep } from '../../lib/practice';
import { toneStyle } from '../../lib/stages';
import { useTraining, useVariant } from '../../store/training';
import { useUi } from '../../store/ui';
import type { Grade, ObjectionCard, ObjectionVariant } from '../../types';
import { Button, Kbd } from '../ui/Button';
import { isCommonObjection } from '../../data/starterDeck';

const MODE_TITLE = { 'warm-up': 'חימום', deck: 'כל החפיסה', card: 'כרטיסייה אחת' } as const;

/**
 * One practice session: the objection first, said out loud, then the answer to compare with.
 * Space flips the card, 1–4 grade it, Esc ends the session.
 */
export function FlashcardSession() {
  const session = useTraining((s) => s.session);
  const cards = useTraining((s) => s.deck?.cards ?? []);
  const flip = useTraining((s) => s.flip);
  const grade = useTraining((s) => s.grade);
  const stop = useTraining((s) => s.stop);
  const start = useTraining((s) => s.start);
  const setView = useUi((s) => s.setView);

  const card = session ? cards.find((item) => item.id === session.queue[0]) : undefined;
  const done = session ? session.answered.length : 0;
  const finished = Boolean(session && session.queue.length === 0);

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || useUi.getState().paletteOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        stop();
        return;
      }
      if (finished) return;
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        if (!session.flipped) flip();
        return;
      }
      const digit = /^(?:Digit|Numpad)([1-4])$/.exec(event.code);
      if (digit && session.flipped) {
        event.preventDefault();
        grade(Number(digit[1]) as Grade);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, finished, flip, grade, stop]);

  if (!session) return null;

  return (
    <section aria-label="תרגול" className="glass rounded-[28px] px-5 py-5 sm:px-8 sm:py-7">
      <div className="flex items-center gap-3">
        <p className="text-[13px] font-medium text-fg-muted">
          {MODE_TITLE[session.mode]} ·{' '}
          {finished ? 'הסתיים' : (
            <span className="tabular-nums">
              כרטיסייה {Math.min(done + 1, done + session.queue.length)} מתוך {done + session.queue.length}
            </span>
          )}
        </p>
        <Button variant="ghost" size="sm" className="ms-auto" onClick={stop}>
          <X className="size-4" aria-hidden />
          סיום
          <Kbd className="ms-0.5 max-sm:hidden">Esc</Kbd>
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-field" role="progressbar" aria-valuemin={0} aria-valuemax={done + session.queue.length} aria-valuenow={done}>
        <motion.span
          className="block h-full rounded-full bg-[var(--st-zoom)]"
          animate={{ width: `${(done / Math.max(1, done + session.queue.length)) * 100}%` }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {finished ? (
          <Summary
            key="summary"
            results={session.answered.map((item) => item.grade)}
            mode={session.mode}
            onAgain={() => start('warm-up')}
            onCalls={() => {
              stop();
              setView('today');
            }}
          />
        ) : card ? (
          <motion.div
            key={`${card.id}-${done}-${session.flipped ? 'back' : 'front'}`}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="mt-6"
          >
            <CardFace card={card} flipped={session.flipped} onFlip={flip} onGrade={grade} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/** The card on top, with the answer tailored to the chosen niche when there is one */
function CardFace({ card, flipped, onFlip, onGrade }: { card: ObjectionCard; flipped: boolean; onFlip: () => void; onGrade: (grade: Grade) => void }) {
  const variant = useVariant(card);
  const niche = useTraining((s) => s.niche);
  const tailored = variant && niche ? { variant, niche } : null;
  return flipped ? <Back card={card} tailored={tailored} onGrade={onGrade} /> : <Front card={card} tailored={tailored} onFlip={onFlip} />;
}

type Tailoring = { variant: ObjectionVariant; niche: string } | null;

function Heard({ card, tailored }: { card: ObjectionCard; tailored: Tailoring }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
      <span style={toneStyle('var(--st-zoom)')} className="tone-chip rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold">
        {CATEGORY_LABEL[card.category]}
      </span>
      {tailored && (
        <span style={toneStyle('var(--st-won)')} className="tone-chip rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold">
          <bdi>{tailored.niche}</bdi>
        </span>
      )}
      <span>
        {isCommonObjection(card)
          ? 'התנגדות נפוצה בשיחות קרות'
          : `${card.leadCount === 1 ? 'עלתה אצל ליד אחד' : `עלתה אצל ${card.leadCount} לידים`}${card.mentions > card.leadCount ? `, ${countOf(card.mentions, NOUNS.time)}` : ''}`}
      </span>
    </p>
  );
}

function Front({ card, tailored, onFlip }: { card: ObjectionCard; tailored: Tailoring; onFlip: () => void }) {
  const source = card.sources[0];
  return (
    <div className="flex min-h-[300px] flex-col">
      <Heard card={card} tailored={tailored} />
      <p className="mt-5 text-[14px] font-medium text-fg-muted">הלקוח אומר לך:</p>
      <p dir="auto" className="mt-1.5 text-[26px] leading-[1.25] font-semibold tracking-[-0.02em] text-balance sm:text-[32px]">
        "{tailored?.variant.objection || card.objection}"
      </p>
      {source && (
        <p className="mt-3 flex gap-2 text-[13px] text-fg-faint">
          <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span dir="auto" className="min-w-0">
            {source.leadName}
          </span>
        </p>
      )}
      <div className="mt-auto flex flex-col items-start gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] text-pretty text-fg-muted">
          <span className="font-semibold text-fg">מה עונים?</span> אומרים את התשובה בקול, כמו בשיחה, ואז הופכים את הכרטיסייה.
        </p>
        <Button variant="primary" onClick={onFlip} className="max-sm:w-full">
          הצגת התשובה
          <Kbd className="ms-1">Space</Kbd>
        </Button>
      </div>
    </div>
  );
}

function Back({ card, tailored, onGrade }: { card: ObjectionCard; tailored: Tailoring; onGrade: (grade: Grade) => void }) {
  const variant = tailored?.variant;
  const response = variant?.response || card.response;
  const followUp = variant?.followUp || card.followUp;
  const insight = variant?.insight || card.insight;
  const alternatives = variant?.alternatives.length ? variant.alternatives : card.alternatives;
  const coachLabel = tailored ? (
    <>
      {card.myResponse ? 'הגרסה של המאמן' : 'מה לומר'}, ל<bdi>{tailored.niche}</bdi>
    </>
  ) : card.myResponse ? (
    'הגרסה של המאמן'
  ) : (
    'מה לומר'
  );

  return (
    <div className="flex flex-col">
      <Heard card={card} tailored={tailored} />
      <p dir="auto" className="mt-3 text-[17px] font-semibold text-pretty text-fg-muted">
        "{variant?.objection || card.objection}"
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {card.myResponse && (
            <div>
              <p className="text-[12.5px] font-medium text-fg-muted">התשובה שלך</p>
              <p dir="auto" style={toneStyle('var(--st-won)')} className="script-line mt-1.5 px-3 py-2 text-[16px] leading-relaxed text-pretty whitespace-pre-line">
                {card.myResponse}
              </p>
            </div>
          )}
          <div>
            <p className="text-[12.5px] font-medium text-fg-muted">{coachLabel}</p>
            <p dir="auto" style={toneStyle('var(--st-zoom)')} className={cn('script-line mt-1.5 px-3 py-2 leading-relaxed text-pretty', card.myResponse ? 'text-[14.5px]' : 'text-[17px]')}>
              {response}
            </p>
          </div>
          {followUp && (
            <p className="flex gap-2 text-[14.5px]">
              <ArrowRight className="flip-rtl mt-1 size-4 shrink-0 text-[var(--st-cold)]" aria-hidden />
              <span className="min-w-0 text-pretty">
                <span className="text-fg-muted">ואז לשאול: </span>
                <span dir="auto">{followUp}</span>
              </span>
            </p>
          )}
          {variant && (
            <details className="group text-[13px]">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                התשובה הכללית
              </summary>
              <p dir="auto" className="mt-2 ps-5.5 text-pretty text-fg-muted">
                {card.response}
              </p>
            </details>
          )}
        </div>
        <div className="flex flex-col gap-4 lg:border-s lg:border-line lg:ps-5">
          {insight && (
            <p dir="auto" className="flex gap-2 text-[13.5px] text-fg-muted">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-[var(--st-no-answer)]" aria-hidden />
              <span className="min-w-0 text-pretty">{insight}</span>
            </p>
          )}
          {alternatives.length > 0 && (
            <div>
              <p className="text-[12.5px] font-medium text-fg-muted">עוד דרכים לענות</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {alternatives.map((alternative, index) => (
                  <li key={index} dir="auto" className="flex gap-2 text-[13.5px] text-pretty">
                    <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
                    <span className="min-w-0">{alternative}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="mt-7">
        <p className="text-[13px] font-medium text-fg-muted">כמה התשובה שלך הייתה קרובה?</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="דירוג התשובה שלך">
          {GRADES.map((option) => (
            <button
              key={option.grade}
              type="button"
              onClick={() => onGrade(option.grade)}
              style={toneStyle(option.tone)}
              className="action-button flex min-h-14 flex-col items-center justify-center rounded-xl px-2 py-2 transition-[background-color,transform] active:scale-[0.97]"
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <Kbd className="text-current">{option.key}</Kbd>
                {option.label}
              </span>
              <span className="text-[11.5px] font-normal opacity-80">תחזור {comesBack(nextStep(card.practice, option.grade).days)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Summary({ results, mode, onAgain, onCalls }: { results: Grade[]; mode: string; onAgain: () => void; onCalls: () => void }) {
  const count = (grade: Grade) => results.filter((item) => item === grade).length;
  const missed = count(1);
  const due = useTraining((s) => (s.deck?.cards ?? []).filter((card) => !card.retired && Date.parse(card.practice.dueAt) <= Date.now()).length);
  return (
    <motion.div key="summary" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="mt-6 flex flex-col items-start gap-4">
      <div>
        <p className="text-[26px] font-semibold tracking-[-0.02em]">{mode === 'warm-up' ? 'החימום הושלם.' : 'התרגול הושלם.'}</p>
        <p className="mt-1 text-[14px] text-fg-muted">
          {count(4) + count(3)} טובות, {count(2)} קשות, {missed} שלא ידעת.{' '}
          {missed ? 'מה שלא ידעת יעלה ראשון בפעם הבאה.' : 'מה שידעת יחזור בעוד כמה ימים, ומה שעוד לא יושב יחזור מוקדם יותר.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onCalls}>
          <CalendarCheck className="size-4" aria-hidden />
          לשיחות של היום
        </Button>
        {due > 0 && (
          <Button onClick={onAgain}>
            <RotateCcw className="size-4" aria-hidden />
            {due === 1 ? 'עוד כרטיסייה אחת לתרגול' : `עוד ${due} כרטיסיות לתרגול`}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
