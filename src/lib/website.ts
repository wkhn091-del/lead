/** A domain or an http(s) address; the server applies the same rule. Other schemes are refused, since they become links. */
const WEBSITE = /^(https?:\/\/)?[^\s/?#:@]+\.[^\s/?#:@]{2,}(:\d{1,5})?([/?#]\S*)?$/i;

export const isValidWebsite = (value: string) => value.length <= 500 && WEBSITE.test(value);

/** A safe link for a stored website, or null. */
export function websiteHref(value: string): string | null {
  const site = value.trim();
  if (!site || !isValidWebsite(site)) return null;
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

/** "https://www.arbel.co.il/" reads as "arbel.co.il" */
export const websiteLabel = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
