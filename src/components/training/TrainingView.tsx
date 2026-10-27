import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, GraduationCap, Layers, LoaderCircle, Lock, Play, Quote, RefreshCw, Save, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { repository } from '../../data/repository';
import { isCommonObjection } from '../../data/starterDeck';
import { cn } from '../../lib/cn';
import { drafts } from '../../lib/drafts';
import { formatRelative } from '../../lib/format';
import { count, ltr, NOUNS } from '../../lib/hebrew';
import { LANGUAGES, readLanguage, saveLanguage } from '../../lib/language';
import { EASE_OUT } from '../../lib/motion';
import { BOX_DAYS, CATEGORY_LABEL, dueCards, TOP_BOX, WARM_UP_SIZE } from '../../lib/practice';
import { toneStyle } from '../../lib/stages';
import { useTimeline } from '../../store/timeline';
import { useTraining, useVariant } from '../../store/training';
import { useUi } from '../../store/ui';
import type { CoachLanguage, ObjectionCard } from '../../types';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { inputBase } from '../ui/styles';
import { FlashcardSession } from './FlashcardSession';
import { NicheBar } from './NicheBar';

/** Objection training: flashcards the AI coach builds from past calls, practised before the Daily 10. */
export function TrainingView() {
  const deck = useTraining((s) => s.deck);
  const status = useTraining((s) => s.status);
  const error = useTraining((s) => s.error);
  const session = useTraining((s) => s.session);
  const load = useTraining((s) => s.load);

  useEffect(() => {
    void load();
    const { niche, loadNiches, loadVariants } = useTraining.getState();
    void loadNiches();
    if (niche) void loadVariants(niche);
  }, [load]);

  if (!deck) {
    return status === 'error' ? (
      <div className="glass flex flex-col items-center rounded-[22px] px-6 py-14 text-center">
        <h2 className="text-[17px] font-semibold">לא הצלחנו לטעון את החפיסה</h2>
        <p className="mt-1.5 max-w-md text-[14px] text-fg-muted">{error}</p>
        <Button className="mt-5" onClick={() => void load()}>
          לנסות שוב
        </Button>
      </div>
    ) : (
      <div aria-busy="true" aria-label="טוען את החפיסה" className="glass h-56 animate-pulse rounded-[28px]" />
    );
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-3">
        <NicheBar activeCards={deck.cards.filter((card) => !card.retired).length} />
        {session ? <FlashcardSession /> : <TrainingHero />}
      </div>
      <DeckList cards={deck.cards} />
    </div>
  );
}

function TrainingHero() {
  const deck = useTraining((s) => s.deck)!;
  const generating = useTraining((s) => s.generating);
  const generate = useTraining((s) => s.generate);
  const start = useTraining((s) => s.start);
  const coach = useTimeline((s) => s.features?.coach);
  const [language, setLanguage] = useState<CoachLanguage>(readLanguage);
  const active = deck.cards.filter((card) => !card.retired);
  const due = dueCards(deck.cards).length;
  const { run } = deck;
  // Only the common objections so far: no deck built from your calls yet
  const starter = !run || run.provider === 'starter';
  const fromCalls = active.filter((card) => !isCommonObjection(card)).length;
  const canGenerate = repository.kind === 'remote' && Boolean(coach);

  return (
    <section aria-label="אימון התנגדויות" className="glass rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-0">
        <div className="min-w-0 lg:pe-10">
          <p className="flex items-center gap-2 text-[13px] font-medium text-fg-muted">
            <GraduationCap className="size-4 text-[var(--st-zoom)]" aria-hidden />
            אימון התנגדויות
          </p>
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-[48px] leading-[0.92] tracking-[-0.04em] tabular-nums [font-weight:540] [font-stretch:86%] sm:text-[60px]">
              <AnimatedNumber value={due} />
              <span className="sr-only">{due}</span>
            </span>
            <span className="text-[17px] text-fg-muted">
              {due === 1 ? 'התנגדות לתרגול היום' : due ? 'התנגדויות לתרגול היום' : 'התנגדויות לתרגול, הכול מעודכן'}
            </span>
          </p>
          <p className="mt-3 max-w-prose text-[14px] text-pretty text-fg-muted">
            {starter
              ? 'ההתנגדויות שהכי נפוץ לשמוע בשיחות קרות על אתרים, עם תשובה לכל אחת. כל כרטיסייה שואלת: מה עונים כשהלקוח אומר את זה? עונים בקול, ואז הופכים.'
              : 'התשובות שתצטרכו בשיחות של היום: ההתנגדויות הנפוצות, ומה שהלקוחות שלך באמת אמרו. עונים בקול על כל אחת, ואז הופכים את הכרטיסייה.'}{' '}
            מה שכבר יושב טוב חוזר בעוד כמה ימים, ומה שעוד לא חוזר מחר.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" disabled={!due} onClick={() => start('warm-up')}>
              <Play className="flip-rtl size-4" aria-hidden />
              {due ? `חימום · ${count(Math.min(due, WARM_UP_SIZE), NOUNS.card)}` : 'אין מה לתרגל עכשיו'}
            </Button>
            <Button disabled={!active.length} onClick={() => start('deck')}>
              <Layers className="size-4" aria-hidden />
              {active.length === 1 ? 'תרגול הכרטיסייה' : `תרגול כל ${active.length} הכרטיסיות`}
            </Button>
          </div>
        </div>

        <div className="min-w-0 lg:border-s lg:border-line lg:ps-10">
          <p className="text-[13px] font-medium text-fg-muted">החפיסה שלך</p>
          <p className="mt-3 text-[15px] text-pretty">
            {count(active.length, NOUNS.objection)}
            {!starter && run && (
              <span className="text-fg-muted">
                {', '}
                {fromCalls === 1 ? 'אחת מהן' : `${fromCalls} מהן`} מתוך {count(run.leadsAnalyzed, NOUNS.lead)}
                {run.conversations > 0 && ` ${and(count(run.conversations, NOUNS.call))}`}
              </span>
            )}
          </p>
          <p className="mt-1 text-[13px] text-pretty text-fg-faint">
            {starter
              ? 'חפיסת פתיחה: ההתנגדויות הנפוצות. כשיהיו שיחות מתועדות, המאמן יוסיף את מה שהלקוחות שלך אומרים, במילים שלהם.'
              : `עודכנה ${formatRelative(run!.createdAt)} · ${run!.model}`}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Segmented label="שפת הכרטיסיות" value={language} options={LANGUAGES} onChange={(value) => { setLanguage(value); saveLanguage(value); }} className="h-10" />
            <Button variant={starter ? 'primary' : 'secondary'} disabled={!canGenerate || generating} onClick={() => void generate(language)}>
              {generating ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : starter ? <Sparkles className="size-4" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              {generating ? 'קורא את השיחות שלך…' : starter ? 'הוספה מתוך השיחות שלי' : 'רענון מתוך השיחות שלי'}
            </Button>
          </div>
          <p className="mt-2.5 text-[12.5px] text-pretty text-fg-faint">
            {generating
              ? 'המאמן קורא את התמלולים, שיחות הוואטסאפ וההערות. זה לוקח עד דקה.'
              : !canGenerate
                ? repository.kind === 'local'
                  ? 'האפליקציה לא מחוברת לשרת. המאמן מוסיף לחפיסה מתוך השיחות שלך בשרת.'
                  : `צריך את מאמן ה-AI: הגדירו ${ltr('AI_PROVIDER')} ו-${ltr('AI_API_KEY')} בשרת (בחינם: ${ltr('AI_PROVIDER=gemini')} עם מפתח מ-${ltr('Google AI Studio')}).`
                : 'התשובות שלך והיסטוריית התרגול נשמרות כשהחפיסה מתרעננת.'}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-faint">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            מספרי טלפון, אימיילים ואתרים אף פעם לא נשלחים ל-AI.
          </p>
        </div>
      </div>
    </section>
  );
}

/** "ו" joins the last item: "ושיחה אחת", "ו-12 שיחות" */
const and = (text: string) => (/^\d/.test(text) ? `ו-${text}` : `ו${text}`);

const dueLabel = (card: ObjectionCard) => {
  const days = Math.ceil((Date.parse(card.practice.dueAt) - Date.now()) / 86_400_000);
  if (days <= 0) return 'לתרגול עכשיו';
  if (days === 1) return 'מחר';
  if (days === 2) return 'בעוד יומיים';
  return `בעוד ${days} ימים`;
};

function DeckList({ cards }: { cards: ObjectionCard[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const active = useMemo(() => cards.filter((card) => !card.retired), [cards]);
  const retired = cards.filter((card) => card.retired);

  if (!cards.length) {
    return (
      <div className="glass flex flex-col items-center rounded-[22px] px-6 py-12 text-center">
        <h2 className="text-[17px] font-semibold">עדיין אין כרטיסיות</h2>
        <p className="mt-1.5 max-w-md text-[14px] text-pretty text-fg-muted">
          אחרי שכמה שיחות יתועדו עם סיכום או תמלול, אפשר לבנות את החפיסה: המאמן ימצא את ההתנגדויות שחוזרות שוב ושוב.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="החפיסה" className="flex flex-col gap-2.5">
      <h2 className="px-1 text-[13px] font-medium text-fg-muted">השכיחות ביותר קודם</h2>
      <ul className="flex flex-col gap-2.5">
        {active.map((card) => (
          <CardRow key={card.id} card={card} open={openId === card.id} onToggle={() => setOpenId(openId === card.id ? null : card.id)} />
        ))}
      </ul>
      {retired.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowRetired(!showRetired)} className="flex items-center gap-1.5 px-1 text-[13px] text-fg-muted hover:text-fg">
            <ChevronDown className={cn('size-4 transition-transform', showRetired && 'rotate-180')} aria-hidden />
            כבר לא עולות ({retired.length})
          </button>
          {showRetired && (
            <ul className="mt-2.5 flex flex-col gap-2.5 opacity-70">
              {retired.map((card) => (
                <CardRow key={card.id} card={card} open={openId === card.id} onToggle={() => setOpenId(openId === card.id ? null : card.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function BoxMeter({ box }: { box: number }) {
  return (
    <span
      className="flex items-center gap-0.5"
      title={`שלב ${box} מתוך ${TOP_BOX}: ${BOX_DAYS[box - 1] ? `חוזרת כל ${count(BOX_DAYS[box - 1], NOUNS.day).replace(/^יום אחד$/, 'יום')}` : 'חוזרת בכל תרגול'}`}
    >
      {Array.from({ length: TOP_BOX }, (_, index) => (
        <span key={index} className={cn('h-2 w-1.5 rounded-full', index < box ? 'bg-[var(--st-zoom)]' : 'bg-line-strong')} />
      ))}
      <span className="sr-only">
        שלב {box} מתוך {TOP_BOX}
      </span>
    </span>
  );
}

function CardRow({ card, open, onToggle }: { card: ObjectionCard; open: boolean; onToggle: () => void }) {
  const start = useTraining((s) => s.start);
  const saveResponse = useTraining((s) => s.saveResponse);
  const niche = useTraining((s) => s.niche);
  const variant = useVariant(card);
  const openProfile = useUi((s) => s.openProfile);
  // Your answer is kept on this device as you type it, until it's saved
  const draftKey = `my-answer:${card.id}`;
  const [draft, setDraftState] = useState(() => drafts.read<string>(draftKey) ?? card.myResponse);
  const setDraft = (text: string) => {
    setDraftState(text);
    if (text.trim() === card.myResponse) drafts.clear(draftKey);
    else drafts.write(draftKey, text);
  };
  const [saving, setSaving] = useState(false);
  const due = Date.parse(card.practice.dueAt) <= Date.now() && !card.retired;
  useEffect(() => {
    if (drafts.read(draftKey) === null) setDraftState(card.myResponse);
  }, [card.myResponse, draftKey]);

  return (
    <li className="glass rounded-[20px]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3.5 text-start sm:px-5">
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-[15px] font-semibold tracking-[-0.005em]">{variant?.objection || card.objection}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-muted">
            <span style={toneStyle('var(--st-zoom)')} className="tone-text font-medium">{CATEGORY_LABEL[card.category]}</span>
            <span>
              {isCommonObjection(card)
                ? 'נפוצה בשיחות קרות'
                : `${count(card.leadCount, NOUNS.lead)}${card.mentions > card.leadCount ? ` · ${count(card.mentions, NOUNS.time)}` : ''}`}
            </span>
            {variant && niche && (
              <span className="text-[var(--st-zoom)]">
                מותאמת ל<bdi>{niche}</bdi>
              </span>
            )}
            {card.myResponse && <span className="text-[var(--st-won)]">התשובה שלך שמורה</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <BoxMeter box={card.practice.box} />
          <span className={cn('text-[12px]', due ? 'font-medium text-[var(--st-no-answer)]' : 'text-fg-faint')}>{card.retired ? 'כבר לא עולה' : dueLabel(card)}</span>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="overflow-hidden">
            <div className="flex flex-col gap-4 border-t border-line px-4 py-4 sm:px-5">
              {variant && niche && (
                <p className="text-[12.5px] font-medium text-[var(--st-zoom)]">
                  התשובה ל<bdi>{niche}</bdi>
                </p>
              )}
              <p dir="auto" style={toneStyle('var(--st-zoom)')} className={cn('script-line px-3 py-1.5 text-[14.5px] leading-relaxed text-pretty', variant && '-mt-2.5')}>
                {variant?.response || card.response}
              </p>
              {(variant?.followUp || card.followUp) && (
                <p className="text-[13.5px] text-pretty">
                  <span className="text-fg-muted">ואז לשאול: </span>
                  <span dir="auto">{variant?.followUp || card.followUp}</span>
                </p>
              )}
              {(variant?.insight || card.insight) && <p dir="auto" className="text-[13px] text-pretty text-fg-muted">{variant?.insight || card.insight}</p>}
              {variant && (
                <details className="group text-[13px]">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                    התשובה הכללית
                  </summary>
                  <div className="mt-2 space-y-1.5 ps-5.5 text-pretty text-fg-muted">
                    <p dir="auto">"{card.objection}"</p>
                    <p dir="auto">{card.response}</p>
                  </div>
                </details>
              )}

              {card.sources.length > 0 && (
                <div>
                  <p className="text-[12.5px] font-medium text-fg-muted">איפה זה נאמר</p>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {card.sources.map((source, index) => (
                      <li key={index} className="flex gap-2 text-[13px]">
                        <Quote className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
                        <span className="min-w-0 text-pretty">
                          <span dir="auto">"{source.quote}"</span>{' '}
                          <button type="button" onClick={() => openProfile(source.leadId, 'timeline')} className="text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
                            <span dir="auto">{source.leadName}</span>
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label htmlFor={`my-answer-${card.id}`} className="text-[12.5px] font-medium text-fg-muted">
                  התשובה שלך, במילים שלך
                </label>
                <textarea
                  id={`my-answer-${card.id}`}
                  dir="auto"
                  rows={3}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="איך לומר את זה במילים שלך. התשובה הזו תופיע ראשונה כשמתרגלים את הכרטיסייה."
                  className={cn(inputBase, 'mt-1.5 resize-y px-3.5 py-2.5 text-base leading-relaxed sm:text-[14px]')}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={saving || draft.trim() === card.myResponse}
                    onClick={async () => {
                      setSaving(true);
                      await saveResponse(card.id, draft.trim());
                      drafts.clear(draftKey);
                      setSaving(false);
                    }}
                  >
                    <Save className="size-4" aria-hidden />
                    {saving ? 'שומר…' : 'שמירת התשובה שלי'}
                  </Button>
                  {!card.retired && (
                    <Button size="sm" variant="ghost" onClick={() => start('card', card.id)}>
                      <Play className="flip-rtl size-4" aria-hidden />
                      תרגול הכרטיסייה
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
