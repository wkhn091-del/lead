/**
 * An address as an origin ("https://omek-leads.vercel.app"), the way browsers send it in the Origin header. Forgives
 * how it's written in a setting: without the scheme ("omek-leads.vercel.app" means https), with a trailing slash or
 * a path, in capitals. Null when it isn't a web address.
 */
export function toOrigin(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** CORS_ORIGINS: addresses separated by commas, each as an origin, without repeats */
export function parseOrigins(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map(toOrigin).filter((origin): origin is string => origin !== null))];
}
