import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { SPRING } from '../lib/motion';
import { useUi } from '../store/ui';
import { useViewTabs } from './ViewTabs';

/**
 * The views at the bottom of the screen on phones, within thumb reach, the way an installed app has them.
 * It steps aside while the keyboard is up (see .tabbar in index.css).
 */
export function TabBar() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const tabs = useViewTabs();

  return (
    <nav aria-label="תצוגות" className="tabbar fixed inset-x-0 bottom-0 z-30 sm:hidden">
      <div className="flex h-[60px] items-stretch">
        {tabs.map((tab) => {
          const active = tab.value === view;
          return (
            <button
              key={tab.value}
              type="button"
              aria-current={active ? 'page' : undefined}
              aria-label={tab.badge ? `${tab.label} (${tab.badge})` : tab.label}
              onClick={() => {
                if (active) window.scrollTo({ top: 0, behavior: 'smooth' });
                else setView(tab.value);
              }}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-muted',
              )}
            >
              <span className="relative flex h-7 w-14 items-center justify-center">
                {active && <motion.span layoutId="tabbar-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--primary)_13%,transparent)]" />}
                <tab.icon className="relative size-[19px]" strokeWidth={active ? 2.25 : 1.9} aria-hidden />
                {tab.badge && (
                  <span
                    dir="ltr"
                    className="absolute -top-1 start-[60%] flex h-4 min-w-4 items-center justify-center rounded-full bg-raised px-1 text-[10px] leading-none font-semibold text-fg-muted tabular-nums shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line"
                  >
                    {tab.badge}
                  </span>
                )}
                {tab.busy && <span className="absolute top-0 start-[62%] size-2 animate-pulse rounded-full bg-[var(--st-cold)]" role="status" aria-label="חיפוש רץ" />}
              </span>
              <span className="relative">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
