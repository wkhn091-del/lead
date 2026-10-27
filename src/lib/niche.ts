import type { Lead } from '../types';
import { nicheKey, nicheOf } from '../../server/src/training/niche';

// The server's rules for what a lead's niche is (server/src/training/niche.ts), so both group leads alike.
export { nicheKey, nicheOf };

/** The niches of these leads, the most leads first: "מסעדות" (4), "עורכי דין" (2)… */
export function nicheCounts(leads: readonly Pick<Lead, 'campaign'>[]): { niche: string; key: string; count: number }[] {
  const found = new Map<string, { niche: string; key: string; count: number }>();
  for (const lead of leads) {
    const niche = nicheOf(lead.campaign);
    if (!niche) continue;
    const key = nicheKey(niche);
    const known = found.get(key);
    if (known) known.count += 1;
    else found.set(key, { niche, key, count: 1 });
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.niche.localeCompare(b.niche, 'he'));
}
