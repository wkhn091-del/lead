import { motion } from 'motion/react';
import { History, LoaderCircle, Sparkles, SquarePen, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useId } from 'react';
import { handleRadioKeys } from '../lib/a11y';
import { cn } from '../lib/cn';
import { dealPhrase } from '../lib/deal';
import { formatDate } from '../lib/format';
import { readLanguage } from '../lib/language';
import { SPRING } from '../lib/motion';
import { ARCHIVED_META, OUTCOME_META, STAGE_META } from '../lib/stages';
import { isOpen, nextStage } from '../lib/workflow';
import { useLeadStore } from '../store/leads';
import { useTimeline } from '../store/timeline';
import { toast } from '../store/toasts';
import { useUi, type ProfileTab } from '../store/ui';
import type { ActionType, Lead } from '../types';
import { CoachPanel } from './profile/CoachPanel';
import { DetailsPanel } from './profile/DetailsPanel';
import { TimelinePanel } from './profile/TimelinePanel';
import { StageStepper } from './StageStepper';
import { Button } from './ui/Button';

interface LeadDetailsProps {
  lead: Lead;
  /** Called after the lead is deleted, for example to close a dialog */
  onDeleted?: () => void;
}

/**
 * A lead's profile: where it is in the funnel and the quick steps, then three tabs: the timeline of every
 * call, meeting and note (with recordings), the details (the business, the contact, the strategy and the deal),
 * and the AI coach.
 */
export function LeadDetails({ lead, onDeleted }: LeadDetailsProps) {
  const removeLead = useLeadStore((s) => s.removeLead);
  const act = useLeadStore((s) => s.act);
  const undo = useLeadStore((s) => s.undo);
  const tab = useUi((s) => s.profileTab);
  const setTab = useUi((s) => s.setProfileTab);
  const profile = useTimeline((s) => s.profiles[lead.id]);
  const load = useTimeline((s) => s.load);
  const coachOn = useTimeline((s) => Boolean(s.features?.coach));
  const analyzing = useTimeline((s) => s.coachRuns[lead.id]?.status === 'running');
  const runCoach = useTimeline((s) => s.runCoach);
  const tabsId = useId();

  // Load the timeline when the profile opens; a cached one shows at once and refreshes quietly.
  useEffect(() => {
    void load(lead.id, Boolean(useTimeline.getState().profiles[lead.id]));
  }, [lead.id, load]);

  const next = nextStage(lead.stage);
  const open = isOpen(lead);
  const deal = dealPhrase(lead.deal, lead.currency);

  const run = (type: ActionType) => {
    const result = act(lead.id, type);
    if (!result) return;
    const closing = type === 'advance' && next === 'closed';
    // The deal's amounts are in the Details tab, which starts on the setup fee of a deal that just closed.
    if (closing) setTab('details');
    const message = {
      advance: closing ? 'העסקה נסגרה' : next ? `עבר לשלב ${STAGE_META[next].label}` : '',
      answered: 'השיחה תועדה',
      no_answer: 'תועד: אין מענה',
      archive: 'סומן כלא רלוונטי',
    }[type];
    toast.show({
      message,
      description: closing ? 'רשמו את סכומי העסקה כדי שייכנסו להכנסות.' : undefined,
      duration: 8000,
      action: { label: 'ביטול', onClick: () => undo(lead.id, result.id) },
    });
  };

  /**
   * "ניתוח עסקה": opens the coach and runs it, unless its last analysis already covers everything on the
   * timeline (then it just shows it; "ניתוח מחדש" there runs it again).
   */
  const analyzeDeal = () => {
    setTab('coach');
    if (!coachOn || analyzing || profile?.status !== 'ready') return;
    const report = profile.coaching;
    const current =
      report && report.provider !== 'sample' && !profile.interactions.some((entry) => Date.parse(entry.updatedAt) > Date.parse(report.createdAt));
    if (!current) void runCoach(lead.id, readLanguage());
  };

  const tabs: { value: ProfileTab; label: string; icon: LucideIcon; badge?: string }[] = [
    { value: 'timeline', label: 'ציר זמן', icon: History, badge: profile?.status === 'ready' && profile.interactions.length ? String(profile.interactions.length) : undefined },
    { value: 'details', label: 'פרטים', icon: SquarePen },
    { value: 'coach', label: 'מאמן AI', icon: Sparkles },
  ];

  return (
    <div className="flex flex-col gap-5 px-4 pt-2 pb-5 sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <StageStepper lead={lead} />
        <div className="flex flex-wrap gap-2">
          {open && (
            <>
              {next && (
                <Button variant="primary" onClick={() => run('advance')}>
                  {STAGE_META[lead.stage].next}
                </Button>
              )}
              <Button onClick={() => run('no_answer')}>
                <OUTCOME_META.no_answer.icon className="size-4" style={{ color: OUTCOME_META.no_answer.tone }} aria-hidden />
                אין מענה
              </Button>
            </>
          )}
          <Button onClick={analyzeDeal} aria-busy={analyzing || undefined} title="תוכנית פעולה, תמחור מומלץ והתנגדויות צפויות, מתוך כל ציר הזמן">
            {analyzing ? (
              <LoaderCircle className="size-4 animate-spin text-[var(--st-zoom)]" aria-hidden />
            ) : (
              <Sparkles className="size-4 text-[var(--st-zoom)]" aria-hidden />
            )}
            {analyzing ? 'מנתח…' : 'ניתוח עסקה'}
          </Button>
          {open && (
            <Button variant="danger" onClick={() => run('archive')}>
              <ARCHIVED_META.icon className="size-4" aria-hidden />
              לא רלוונטי
            </Button>
          )}
        </div>
      </div>

      <div
        role="tablist"
        aria-label={`הפרופיל של ${lead.name}`}
        onKeyDown={(event) => handleRadioKeys(event, tabs.map((item) => item.value), tab, setTab)}
        className="flex h-11 rounded-xl bg-field p-1 ring-1 ring-line ring-inset sm:max-w-md"
      >
        {tabs.map((item) => {
          const active = item.value === tab;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${tabsId}-${item.value}`}
              aria-selected={active}
              aria-controls={`${tabsId}-panel`}
              tabIndex={active ? 0 : -1}
              data-value={item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[13.5px] font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {active && (
                <motion.span
                  layoutId={`${tabsId}-tab`}
                  transition={SPRING}
                  className="absolute inset-0 rounded-[9px] bg-raised shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line"
                />
              )}
              <item.icon className={cn('relative size-4', item.value === 'coach' && 'text-[var(--st-zoom)]')} aria-hidden />
              <span className="relative">{item.label}</span>
              {item.badge && <span className="relative text-[12px] tabular-nums text-fg-faint">{item.badge}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="min-w-0">
        {tab === 'timeline' && <TimelinePanel lead={lead} profile={profile} />}
        {tab === 'details' && <DetailsPanel lead={lead} />}
        {tab === 'coach' && <CoachPanel lead={lead} profile={profile} />}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
        {/* One text node that changes but never comes and goes (see DealSection) */}
        <p className="text-[12.5px] text-fg-faint">{`נוסף ב-${formatDate(lead.createdAt)}${lead.stage === 'closed' && deal ? ` · עסקה של ${deal}` : ''}`}</p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            onDeleted?.();
            removeLead(lead.id);
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          מחיקת הליד
        </Button>
      </div>
    </div>
  );
}
