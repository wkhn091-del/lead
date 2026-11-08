import { ExternalLink, Globe, MapPin, MapPinned } from 'lucide-react';
import { mapsLink } from '../../lib/maps';
import { websiteHref, websiteLabel } from '../../lib/website';
import type { Lead } from '../../types';

const linkStyle =
  'inline-flex min-w-0 items-center gap-1.5 rounded-md font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Where the business is and where to look at it: its city, its Google Maps listing (or a search for it there, by
 * name and city, when no listing is stored) and its website, each opening in a new tab. At the top of the
 * profile, so it's there on every tab. Set in the Details tab.
 */
export function LeadLinks({ lead }: { lead: Lead }) {
  const city = lead.city?.trim() ?? '';
  const maps = mapsLink(lead);
  const site = websiteHref(lead.website);
  if (!city && !maps && !site) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-fg-muted">
      {city && (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4 shrink-0" style={{ color: 'var(--st-lost)' }} aria-hidden />
          <span dir="auto">{city}</span>
        </span>
      )}
      {maps && (
        <a
          href={maps.href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkStyle}
          title={maps.search ? `אין קישור שמור, אז זה חיפוש של ״${lead.name}״ ב${city}` : maps.href}
        >
          <MapPinned className="size-4 shrink-0" style={{ color: 'var(--st-lost)' }} aria-hidden />
          {maps.search ? 'חיפוש בגוגל מפות' : 'גוגל מפות'}
          <ExternalLink className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
        </a>
      )}
      {site && (
        <a href={site} target="_blank" rel="noopener noreferrer" className={linkStyle} title={site}>
          <Globe className="size-4 shrink-0" style={{ color: 'var(--st-cold)' }} aria-hidden />
          <span className="ltr truncate">{websiteLabel(lead.website)}</span>
          <ExternalLink className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
        </a>
      )}
    </div>
  );
}
