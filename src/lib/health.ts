import { CircleX, Flame, Hourglass, Snowflake, Sun, Trophy, type LucideIcon } from 'lucide-react';
import type { DealHealth } from '../types';

/** How the deal analysis reads a deal, as the coach panel and the dashboard show it */
export const HEALTH: Record<DealHealth, { label: string; icon: LucideIcon; tone: string }> = {
  won: { label: 'עסקה סגורה', icon: Trophy, tone: 'var(--st-won)' },
  hot: { label: 'עסקה חמה', icon: Flame, tone: 'var(--st-won)' },
  warm: { label: 'עסקה פושרת', icon: Sun, tone: 'var(--st-answered)' },
  cold: { label: 'עסקה קרה', icon: Snowflake, tone: 'var(--st-cold)' },
  stalled: { label: 'עסקה תקועה', icon: Hourglass, tone: 'var(--st-no-answer)' },
  lost: { label: 'ירדה מהפרק', icon: CircleX, tone: 'var(--st-lost)' },
};
