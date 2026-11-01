import { motion } from 'motion/react';
import { CalendarCheck, GraduationCap, LayoutDashboard, Radar, SquareKanban } from 'lucide-react';
import { useId, useMemo } from 'react';
import { cn } from '../lib/cn';
import { SPRING } from '../lib/motion';
import { dueCards } from '../lib/practice';
import { outcomeBetween } from '../lib/workflow';
import { useLeadStore } from '../store/leads';
import { useProspector } from '../store/prospector';
import { useTraining } from '../store/training';
import { useUi, type View } from '../store/ui';
import { useDashboardData } from './dashboard/useDashboardData';

export interface ViewTab {
  value: View;
  label: string;
  title?: string;
  icon: typeof CalendarCheck;
  badge?: string | null;
  busy?: boolean;
}

/** The app's views, with what each needs to say on its tab: urgent reminders, the day's calls, cards due */
export function useViewTabs(): ViewTab[] {
  const daily = useLeadStore((s) => s.daily);
  const leads = useLeadStore((s) => s.leads);
  const deck = useTraining((s) => s.deck);
  const searching = useProspector((s) => s.searching);
  const { reminders } = useDashboardData();
  const due = deck ? dueCards(deck.cards).length : 0;
  // Leads that need something now; the day's calls and practice have badges of their own
  const urgent = reminders.filter((reminder) => reminder.urgency === 'now' && reminder.lead).length;

  const progress = useMemo(() => {
    if (!daily) return null;
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    const queued = daily.leadIds.map((id) => byId.get(id)).filter((lead) => lead !== undefined);
    const done = queued.filter((lead) => outcomeBetween(lead, daily.startsAt, daily.endsAt)).length;
    return `${done}/${queued.length}`;
  }, [daily, leads]);

  return [
    { value: 'dashboard', label: 'לוח', title: 'לוח בקרה: כסף צפוי, תזכורות ועסקאות פתוחות', icon: LayoutDashboard, badge: urgent ? String(urgent) : null },
    { value: 'today', label: 'היום', title: 'העשירייה היומית', icon: CalendarCheck, badge: progress },
    { value: 'pipeline', label: 'משפך', title: 'משפך המכירות', icon: SquareKanban },
    { value: 'prospector', label: 'מאתר', title: 'מאתר הלידים', icon: Radar, busy: searching },
    { value: 'training', label: 'אימון', title: 'אימון התנגדויות', icon: GraduationCap, badge: due ? String(due) : null },
  ];
}

/**
 * Switches between the dashboard, today's calls, the whole pipeline, finding new leads and objection practice.
 * In the header the tabs take the width their words need (`fit`); in the row under it on tablets they share the
 * full width. Phones get the bar at the bottom of the screen instead (TabBar).
 */
export function ViewTabs({ className, fit = false }: { className?: string; fit?: boolean }) {
  // The header and the row under it are both mounted: each needs its own pill
  const id = useId();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const tabs = useViewTabs();

  return (
    <nav aria-label="תצוגות" className={cn('flex h-11 rounded-xl bg-field p-1 ring-1 ring-line ring-inset', className)}>
      {tabs.map((tab) => {
        const active = tab.value === view;
        return (
          <button
            key={tab.value}
            type="button"
            title={tab.title}
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(tab.value)}
            className={cn(
              'relative flex items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-medium whitespace-nowrap transition-colors',
              fit ? 'flex-auto px-3' : 'min-w-0 flex-1 px-1.5 sm:px-2.5',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-view-tab`}
                transition={SPRING}
                className="absolute inset-0 rounded-[9px] bg-raised shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line"
              />
            )}
            <tab.icon className="relative size-4 shrink-0" aria-hidden />
            <span className="relative">{tab.label}</span>
            {tab.badge && <span className="relative text-[12.5px] tabular-nums text-fg-faint" dir="ltr">{tab.badge}</span>}
            {tab.busy && (
              <span className="relative size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--st-cold)]" role="status" aria-label="חיפוש רץ" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
