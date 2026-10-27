/**
 * A lead's niche is its campaign without the area: the Prospector names campaigns "מסעדות · תל אביב", and
 * leads typed in by hand usually have just the niche ("רופאי שיניים"). Answers tailored to a niche, prices
 * of past deals in it and the dashboard all group leads this way.
 *
 * Plain functions with no imports: the app (src/lib/niche.ts) uses the same rules.
 */

/** "מסעדות · תל אביב" → "מסעדות" */
export function nicheOf(campaign: string): string {
  return campaign.split(/\s+·\s+/)[0].trim().replace(/\s+/g, ' ');
}

/** The form niches are compared and stored by: "מסעדות", "Restaurants" → "restaurants", gershayim unified */
export function nicheKey(niche: string): string {
  return nicheOf(niche)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .slice(0, 60);
}
