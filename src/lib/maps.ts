/** A stored Google Maps link: http(s), one piece, at most 500 characters (the server keeps to the same rule) */
export const isValidMapsUrl = (value: string) => value.length <= 500 && /^https?:\/\/\S+$/i.test(value);

/** An address on Google Maps: google.<tld>/maps…, maps.google.<tld>/…, maps.app.goo.gl/…, goo.gl/maps/… */
export const isGoogleMapsUrl = (value: string) =>
  /^https?:\/\/((?:[\w-]+\.)*google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/|maps\.app\.goo\.gl\/|goo\.gl\/maps)/i.test(value);

export interface MapsLink {
  href: string;
  /** No listing is stored, so this searches Maps for the business by its name and city */
  search: boolean;
}

/**
 * Where to see the lead on Google Maps: its listing when one is stored, otherwise a search for its name in its
 * city. Without a listing or a city there's nothing to go on (a name alone finds too many places), so null.
 */
export function mapsLink(lead: { name: string; city?: string; mapsUrl?: string }): MapsLink | null {
  const stored = (lead.mapsUrl ?? '').trim();
  if (stored && isValidMapsUrl(stored)) return { href: stored, search: false };
  const name = lead.name.trim();
  const city = (lead.city ?? '').trim();
  if (!name || !city) return null;
  return { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city}`)}`, search: true };
}
