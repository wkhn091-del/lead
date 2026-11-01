import { useEffect, useMemo, useState } from 'react';
import { forecast, openDeals, pulseFrom, reminders } from '../../lib/dashboard';
import { dueCards } from '../../lib/practice';
import { outcomeBetween } from '../../lib/workflow';
import { useDashboard } from '../../store/dashboard';
import { useLeadStore } from '../../store/leads';
import { useTimeline } from '../../store/timeline';
import { useTraining } from '../../store/training';
import type { LeadPulse } from '../../types';

/** The time, ticking once a minute: reminders come due and "3 days ago" moves on while the page stays open */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Everything the dashboard shows, from the stores. A lead whose profile was opened this session uses its
 * loaded timeline and analysis, which are fresher than the dashboard's last load.
 */
export function useDashboardData() {
  const now = useNow();
  const leads = useLeadStore((s) => s.leads);
  const daily = useLeadStore((s) => s.daily);
  const serverPulses = useDashboard((s) => s.pulses);
  const snoozed = useDashboard((s) => s.snoozed);
  const profiles = useTimeline((s) => s.profiles);
  const deck = useTraining((s) => s.deck);

  const pulses = useMemo(() => {
    const merged = new Map<string, LeadPulse>(serverPulses ?? []);
    for (const [leadId, profile] of Object.entries(profiles)) {
      if (profile.status === 'ready') merged.set(leadId, pulseFrom(leadId, profile.interactions, profile.coaching));
    }
    return merged;
  }, [serverPulses, profiles]);

  const dailyLeft = useMemo(() => {
    if (!daily) return 0;
    const byId = new Map(leads.map((lead) => [lead.id, lead]));
    return daily.leadIds.filter((id) => {
      const lead = byId.get(id);
      return lead && !outcomeBetween(lead, daily.startsAt, daily.endsAt);
    }).length;
  }, [daily, leads]);
  const practiceDue = useMemo(() => (deck ? dueCards(deck.cards, now).length : 0), [deck, now]);

  return useMemo(() => {
    const deals = openDeals(leads, pulses, now);
    return {
      now,
      loaded: serverPulses !== null,
      deals,
      forecast: forecast(leads, deals, now),
      reminders: reminders(leads, pulses, { dailyLeft, practiceDue }, now).filter((reminder) => !((snoozed[reminder.id] ?? 0) > now)),
    };
  }, [leads, pulses, now, dailyLeft, practiceDue, snoozed, serverPulses]);
}
