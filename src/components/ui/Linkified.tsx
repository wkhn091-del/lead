import type { ReactNode } from 'react';
import { isGoogleMapsUrl } from '../../lib/maps';

/** An http(s) address in text, without the punctuation that usually follows one (a period, a closing bracket) */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}״"]/gi;

/**
 * "https://arbel.co.il/contact/?ref=x" reads as "arbel.co.il/contact…". A Google Maps address says nothing to a
 * reader, so it reads as "פתיחה במפות" (an imported note has it as "גוגל מפות: פתיחה במפות").
 */
export function shortUrl(url: string): string {
  if (isGoogleMapsUrl(url)) return 'פתיחה במפות';
  try {
    const { hostname, pathname, search, hash } = new URL(url);
    const shown = hostname.replace(/^www\./, '') + (pathname === '/' ? '' : pathname.replace(/\/$/, ''));
    const cut = shown.length > 42;
    return (cut ? shown.slice(0, 40) : shown) + (cut || search || hash ? '…' : '');
  } catch {
    return url.length > 42 ? `${url.slice(0, 40)}…` : url;
  }
}

/**
 * Text with its web addresses as links that open in a new tab, each shortened to its site and start (the whole
 * address is in its tooltip). Everything else stays as it was, line breaks included.
 */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <bdi key={start}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
          title={url}
          className="font-medium break-all text-[var(--st-cold)] underline decoration-[color-mix(in_oklab,currentColor_40%,transparent)] underline-offset-4 hover:decoration-current"
        >
          {shortUrl(url)}
        </a>
      </bdi>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
