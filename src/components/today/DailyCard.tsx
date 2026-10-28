import { motion } from 'motion/react';
import { Globe, MessageCircle, PanelRightOpen, PhoneCall, Sparkles, SquarePen, Undo2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { appConfig } from '../../config';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { EASE_OUT } from '../../lib/motion';
import { formatPhone, telHref, whatsAppHref } from '../../lib/phone';
import { ARCHIVED_META, OUTCOME_META, STAGE_META, toneStyle } from '../../lib/stages';
import { websiteHref, websiteLabel } from '../../lib/website';
import { canUndo } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { ActionType } from '../../types';
import { buttonStyles } from '../ui/Button';
import { CampaignTag } from '../ui/StatusBadge';
import type { QueueItem } from './TodayView';

const timeOfDay = new Intl.DateTimeFormat(appConfig.locale, { hour: '2-digit', minute: '2-digit' });

/** "שיחה אחת ללא מענה, אתמול" or "3 שיחות ללא מענה, האחרונה לפני 4 ימים" */
function unanswered(attempts: number, lastAt: string) {
  const since = formatRelative(lastAt);
  return attempts === 1 ? `שיחה אחת ללא מענה, ${since}` : `${attempts} שיחות ללא מענה, האחרונה ${since}`;
}

/** Re-renders every 30 seconds, so Undo disappears when its window closes. */
function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
}

export function DailyCard({ item }: { item: QueueItem }) {
  const { lead, position, outcome } = item;
  const act = useLeadStore((s) => s.act);
  const undo = useLeadStore((s) => s.undo);
  const openProfile = useUi((s) => s.openProfile);
  useTick();

  const run = (type: ActionType) => {
    const result = act(lead.id, type);
    if (!result) return;
    const message = {
      advance: `נקבע זום עם ${lead.name}`,
      answered: `השיחה עם ${lead.name} תועדה`,
      no_answer: `אין מענה אצל ${lead.name}`,
      archive: `${lead.name} סומן כלא רלוונטי`,
    }[type];
    const description = {
      advance: 'כתבו מה נאמר, כדי שהמאמן יוכל להכין את הזום.',
      answered: 'כתבו מה נאמר. מי שענה יוצא מההגרלה היומית, וממשיכים איתו מהמשפך.',
      no_answer: 'הליד נשאר במאגר ליום אחר.',
      archive: undefined,
    }[type];
    toast.show({
      message,
      description,
      duration: 8000,
      action: { label: 'ביטול', onClick: () => undo(lead.id, result.id) },
    });
  };

  const tel = telHref(lead.phone);
  const whatsApp = whatsAppHref(lead.phone);
  const site = websiteHref(lead.website);
  const done = outcome !== null;
  const outcomeMeta = outcome ? OUTCOME_META[outcome.type] : null;

  return (
    <motion.li
      id={`daily-${lead.id}`}
      layout="position"
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className={cn('glass scroll-mt-24 rounded-[22px] transition-opacity duration-300', done && 'opacity-70')}
    >
      <div className="flex gap-3.5 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5">
        <span
          aria-hidden
          style={outcomeMeta ? toneStyle(outcomeMeta.tone) : undefined}
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums sm:size-9',
            outcomeMeta ? 'tone-chip' : 'bg-field text-fg-muted ring-1 ring-line ring-inset',
          )}
        >
          {position}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h3 dir="auto" className="min-w-0 truncate text-[16.5px] font-semibold tracking-[-0.01em]">
              {lead.name}
            </h3>
            <CampaignTag campaign={lead.campaign} />
            {lead.attemptCount > 0 && lead.lastAttemptAt && (
              <span className="text-[12.5px] text-fg-faint">{unanswered(lead.attemptCount, lead.lastAttemptAt)}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-fg-muted">
            {lead.contactName && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserRound className="size-3.5 shrink-0" aria-hidden />
                <span dir="auto" className="truncate">{lead.contactName}</span>
              </span>
            )}
            {lead.phone && <span className="ltr tabular-nums select-all">{formatPhone(lead.phone)}</span>}
            {site && (
              <a href={site} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1.5 hover:text-fg">
                <Globe className="size-3.5 shrink-0" aria-hidden />
                <span className="ltr truncate underline decoration-line-strong underline-offset-4">{websiteLabel(lead.website)}</span>
              </a>
            )}
          </div>

          {lead.approach && (
            <div className="approach mt-3.5 rounded-xl px-3.5 py-2.5">
              <p className="text-[12px] font-medium text-fg-muted">אסטרטגיה</p>
              <p dir="auto" className="mt-0.5 text-[14px] leading-relaxed text-pretty whitespace-pre-line">
                {lead.approach}
              </p>
            </div>
          )}

          {done && outcome && outcomeMeta ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span style={toneStyle(outcomeMeta.tone)} className="tone-chip inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium">
                <outcomeMeta.icon className="size-4" aria-hidden />
                {outcome.type === 'advanced' ? 'נקבע זום' : outcomeMeta.label}
                <span className="font-normal opacity-80">ב-{timeOfDay.format(new Date(outcome.at))}</span>
              </span>
              {canUndo(lead, outcome.id) && (
                <button type="button" onClick={() => undo(lead.id, outcome.id)} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                  <Undo2 className="flip-rtl size-4" aria-hidden />
                  ביטול
                </button>
              )}
              <span className="ms-auto flex gap-1">
                {outcome.type !== 'no_answer' && (
                  <button type="button" onClick={() => openProfile(lead.id, 'timeline', outcome.id)} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                    <SquarePen className="size-4" aria-hidden />
                    הוספת סיכום
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openProfile(lead.id)}
                  aria-label={`הפרטים של ${lead.name}`}
                  className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'max-sm:w-10 max-sm:px-0' })}
                >
                  <PanelRightOpen className="flip-rtl size-4" aria-hidden />
                  <span className="max-sm:sr-only">פרטים</span>
                </button>
              </span>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {tel && (
                  <a href={tel} className={buttonStyles({ size: 'sm', className: 'max-sm:flex-1' })}>
                    <PhoneCall className="size-4" aria-hidden />
                    חיוג
                  </a>
                )}
                {whatsApp && (
                  <a href={whatsApp} target="_blank" rel="noreferrer" className={buttonStyles({ size: 'sm', className: 'max-sm:flex-1' })}>
                    <MessageCircle className="size-4" style={{ color: 'var(--whatsapp)' }} aria-hidden />
                    וואטסאפ
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => openProfile(lead.id, 'coach')}
                  aria-label={`הכנה לשיחה עם ${lead.name} בעזרת מאמן ה-AI`}
                  className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'max-sm:w-10 max-sm:px-0 sm:ms-auto' })}
                >
                  <Sparkles className="size-4 text-[var(--st-zoom)]" aria-hidden />
                  <span className="max-sm:sr-only">הכנה</span>
                </button>
                <button
                  type="button"
                  onClick={() => openProfile(lead.id)}
                  aria-label={`הפרטים של ${lead.name}`}
                  className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'max-sm:w-10 max-sm:px-0' })}
                >
                  <PanelRightOpen className="flip-rtl size-4" aria-hidden />
                  <span className="max-sm:sr-only">פרטים</span>
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`תוצאת השיחה עם ${lead.name}`}>
                <ActionButton tone={STAGE_META.zoom.tone} strong onClick={() => run('advance')} label="נקבע זום" icon={STAGE_META.zoom.icon} />
                <ActionButton tone={OUTCOME_META.answered.tone} onClick={() => run('answered')} label="ענה" hint="בלי זום עדיין" icon={OUTCOME_META.answered.icon} />
                <ActionButton tone={OUTCOME_META.no_answer.tone} onClick={() => run('no_answer')} label="אין מענה" icon={OUTCOME_META.no_answer.icon} />
                <ActionButton tone={ARCHIVED_META.tone} onClick={() => run('archive')} label="לא רלוונטי" icon={ARCHIVED_META.icon} />
              </div>
            </>
          )}
        </div>
      </div>
    </motion.li>
  );
}

interface ActionButtonProps {
  tone: string;
  label: string;
  hint?: string;
  icon: (typeof STAGE_META)['zoom']['icon'];
  strong?: boolean;
  onClick: () => void;
}

function ActionButton({ tone, label, hint, icon: Icon, strong, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={toneStyle(tone)}
      className={cn(
        'action-button flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-[13px] font-semibold transition-[background-color,transform] active:scale-[0.97] sm:flex-row sm:gap-2 sm:text-[14px]',
        strong && 'action-button-strong',
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
      <span>
        {label}
        {hint && <span className="font-normal max-sm:hidden"> {hint}</span>}
      </span>
    </button>
  );
}
