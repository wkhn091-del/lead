import * as cheerio from 'cheerio';
import type { SiteSignals } from './types.js';

/**
 * What the homepage's HTML says about the site: how it's built, how old it is, whether it's made for phones,
 * and whether the basics are there (click-to-call, WhatsApp, a contact form, an accessibility statement).
 * Every signal is something a person could check by opening the page.
 */

interface TechRule {
  name: string;
  /** A current framework or premium builder */
  modern?: boolean;
  test: (html: string, $: cheerio.CheerioAPI) => boolean;
  /** The version, when the page shows it */
  version?: (html: string, $: cheerio.CheerioAPI) => string | null;
}

const has = (pattern: RegExp) => (html: string) => pattern.test(html);
const generator = ($: cheerio.CheerioAPI) => $('meta[name="generator" i]').attr('content')?.trim() ?? '';

const TECH: TechRule[] = [
  { name: 'Next.js', modern: true, test: (html, $) => html.includes('/_next/static') || $('script#__NEXT_DATA__').length > 0 },
  { name: 'Nuxt', modern: true, test: has(/\/_nuxt\/|window\.__NUXT__/) },
  { name: 'Astro', modern: true, test: has(/\/_astro\/|<astro-island/i) },
  { name: 'Gatsby', modern: true, test: has(/id="___gatsby"/) },
  { name: 'Remix', modern: true, test: has(/window\.__remixContext/) },
  { name: 'SvelteKit', modern: true, test: has(/__sveltekit|data-sveltekit/) },
  { name: 'Framer', modern: true, test: has(/framerusercontent\.com|data-framer-|<meta name="generator" content="Framer/i) },
  { name: 'Webflow', modern: true, test: has(/data-wf-site|webflow\.js|website-files\.com|assets\.website-files/i) },
  { name: 'Shopify', test: has(/cdn\.shopify\.com|Shopify\.theme/) },
  { name: 'Wix', test: (html, $) => /static\.wixstatic\.com|static\.parastorage\.com/.test(html) || /wix\.com/i.test(generator($)) },
  { name: 'Squarespace', test: has(/static1\.squarespace\.com|squarespace-cdn\.com/) },
  { name: 'Site123', test: has(/site123|s123-cdn/i) },
  { name: 'Tilda', test: has(/tildacdn\.com|tilda-blocks/i) },
  { name: 'Duda', test: has(/multiscreensite\.com|dudamobile|irp\.cdn-website\.com/i) },
  { name: 'GoDaddy Website Builder', test: has(/img1\.wsimg\.com|websites\.godaddy\.com/i) },
  { name: 'Weebly', test: has(/weebly\.com|editmysite\.com/i) },
  { name: 'Google Sites', test: has(/sites\.google\.com\/|gstatic\.com\/atari/i) },
  {
    name: 'WordPress',
    test: (html, $) => /\/wp-content\/|\/wp-includes\//.test(html) || /wordpress/i.test(generator($)),
    version: (html, $) => /WordPress\s+([\d.]+)/i.exec(generator($))?.[1] ?? /wp-includes\/[^"']+\?ver=([\d.]+)/.exec(html)?.[1] ?? null,
  },
  { name: 'Elementor', test: has(/elementor-(?:element|widget|section)|\/elementor\//) },
  { name: 'Divi', test: has(/et_pb_|\/Divi\//) },
  { name: 'WPBakery', test: has(/vc_row|js_composer/) },
  { name: 'WooCommerce', test: has(/woocommerce/) },
  { name: 'Joomla', test: (html, $) => /joomla/i.test(generator($)) || /\/media\/jui\/|option=com_|\/components\/com_/.test(html), version: (_html, $) => /Joomla!?\s*([\d.]+)/i.exec(generator($))?.[1] ?? null },
  { name: 'Drupal', test: (html, $) => /drupal/i.test(generator($)) || /Drupal\.settings|\/sites\/default\/files\//.test(html), version: (_html, $) => /Drupal\s*([\d.]+)/i.exec(generator($))?.[1] ?? null },
  { name: 'ASP.NET Web Forms', test: has(/__VIEWSTATE/) },
  {
    name: 'jQuery',
    test: has(/jquery/i),
    version: (html) => /jquery[.-]?(\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/i.exec(html)?.[1] ?? /jquery(?:\.min)?\.js\?ver=(\d+\.\d+(?:\.\d+)?)/i.exec(html)?.[1] ?? /jquery\/(\d+\.\d+(?:\.\d+)?)\//i.exec(html)?.[1] ?? null,
  },
  { name: 'Bootstrap', test: has(/bootstrap(?:\.min)?\.(?:css|js)/i), version: (html) => /bootstrap\/(\d+\.\d+(?:\.\d+)?)\//i.exec(html)?.[1] ?? /bootstrap(?:\.min)?\.css\?ver=(\d+\.\d+)/i.exec(html)?.[1] ?? null },
  { name: 'React', test: has(/data-reactroot|react-dom(?:\.production)?(?:\.min)?\.js/i) },
  { name: 'Vue', test: has(/data-v-[0-9a-f]{8}|vue(?:\.min)?\.js/i) },
  { name: 'Tailwind CSS', test: has(/\b(?:sm|md|lg):(?:flex|grid|hidden|block)\b/) },
];

const versionAtMost = (version: string | null, major: number, minor = Infinity) => {
  if (!version) return false;
  const [a, b] = version.split('.').map(Number);
  return a < major || (a === major && (b ?? 0) <= minor);
};

const ACCESSIBILITY_WIDGET = /acsbapp\.com|accessibe|userway\.org|nagish|equalweb|enable\.co\.il|accessibility-?widget|sitelinks\.co\.il\/nagish|onetap|all-in-one-accessibility|pojo-a11y|ally-?widget/i;
const PRIVACY = /privacy|פרטיות|מדיניות-פרטיות|privacy-policy/i;
const ACCESSIBILITY_STATEMENT = /הצהרת\s*נגישות|accessibility\s*statement|נגישות\s*האתר|accessibility-statement|hatsharat-negishut/i;
const COPYRIGHT = /(?:©|&copy;|\(c\)|copyright|כל הזכויות שמורות|זכויות יוצרים)[^0-9]{0,60}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
/** Addresses that belong to the site's tools, not the business */
const NOT_BUSINESS_EMAIL = /@(example\.|sentry\.|wixpress\.com|domain\.com|email\.com|yourdomain|mysite\.)/i;

/** The latest year in the page's copyright lines */
function copyrightYear(text: string, now: Date): number | null {
  let latest: number | null = null;
  for (const match of text.matchAll(COPYRIGHT)) {
    for (const value of [match[1], match[2]]) {
      const year = Number(value);
      if (year >= 1995 && year <= now.getFullYear() + 1) latest = Math.max(latest ?? 0, year);
    }
  }
  return latest;
}

export interface SignalInput {
  html: string;
  finalUrl: string;
  status: number;
  charset: string;
  responseMs: number;
  loadMs: number;
  bytes: number;
  now: Date;
}

/** Text a person would read on the page: no scripts, styles or hidden templates, whitespace collapsed */
export function visibleText($: cheerio.CheerioAPI): string {
  const body = $('body').clone();
  body.find('script, style, noscript, template, svg, iframe, [hidden], [aria-hidden="true"]').remove();
  return body.text().replace(/\s+/g, ' ').trim();
}

/** The page parsed once: its DOM and visible text */
export function parsePage(html: string) {
  const $ = cheerio.load(html);
  return { $, text: visibleText($) };
}

export function extractSignals(input: SignalInput, parsed = parsePage(input.html)): SiteSignals {
  const { html, now } = input;
  const { $, text } = parsed;
  const lowerHtml = html.slice(0, 600_000);

  const tech: string[] = [];
  let modern = false;
  const found = new Map<string, string | null>();
  for (const rule of TECH) {
    if (!rule.test(lowerHtml, $)) continue;
    const version = rule.version?.(lowerHtml, $) ?? null;
    found.set(rule.name, version);
    tech.push(version ? `${rule.name} ${version}` : rule.name);
    if (rule.modern) modern = true;
  }

  const legacy: string[] = [];
  if (/\.swf\b|swfobject|application\/x-shockwave-flash/i.test(lowerHtml)) legacy.push('Flash');
  if (/<frameset|<frame\s/i.test(lowerHtml)) legacy.push('frames');
  if (/<marquee/i.test(lowerHtml)) legacy.push('<marquee>');
  const fontTags = $('font').length;
  if (fontTags >= 3) legacy.push('<font> tags');
  const layoutTables = $('table[width], table[cellpadding], table[bgcolor], td[background]').length;
  if (layoutTables >= 3 && $('table table').length > 0) legacy.push('table layout');
  if (/^(windows-1255|iso-8859-8(-i)?|cp1255)$/.test(input.charset)) legacy.push(`legacy encoding (${input.charset})`);
  if (versionAtMost(found.get('jQuery') ?? null, 1, 11)) legacy.push(`jQuery ${found.get('jQuery')}`);
  if (versionAtMost(found.get('WordPress') ?? null, 4)) legacy.push(`WordPress ${found.get('WordPress')}`);
  if (versionAtMost(found.get('Joomla') ?? null, 3)) legacy.push(`Joomla ${found.get('Joomla')}`);
  if (versionAtMost(found.get('Drupal') ?? null, 7)) legacy.push(`Drupal ${found.get('Drupal')}`);
  if (versionAtMost(found.get('Bootstrap') ?? null, 3)) legacy.push(`Bootstrap ${found.get('Bootstrap')}`);
  if (found.has('ASP.NET Web Forms')) legacy.push('ASP.NET Web Forms');
  if (/<!--\[if (lt )?IE \d/i.test(lowerHtml)) legacy.push('Internet Explorer fixes');

  const viewportContent = $('meta[name="viewport" i]').attr('content') ?? '';
  const links = $('a[href]')
    .map((_, element) => $(element).attr('href') ?? '')
    .get();
  const emails = [
    ...new Set(
      links
        .filter((href) => /^mailto:/i.test(href))
        .map((href) => decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim().toLowerCase())
        .filter((address) => EMAIL.test(address) && !NOT_BUSINESS_EMAIL.test(address)),
    ),
  ].slice(0, 3);

  const headings = $('h1, h2, h3')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 12)
    .map((heading) => heading.slice(0, 120));

  const images = $('img');
  const linkText = links.join(' ');
  const footerAndLinks = `${$('footer').text()} ${$('a').text()} ${linkText}`;

  return {
    finalUrl: input.finalUrl,
    httpStatus: input.status,
    https: input.finalUrl.startsWith('https:'),
    responseMs: input.responseMs,
    loadMs: input.loadMs,
    htmlKb: Math.round(input.bytes / 1024),
    charset: input.charset,
    title: $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 200),
    description: ($('meta[name="description" i]').attr('content') ?? '').trim().slice(0, 300),
    lang: $('html').attr('lang')?.trim() || null,
    viewport: /width\s*=\s*device-width/i.test(viewportContent),
    generator: generator($) || null,
    tech,
    modern,
    legacy,
    copyrightYear: copyrightYear(`${$('footer').text()} ${text.slice(-3000)}`, now),
    scripts: $('script').length,
    stylesheets: $('link[rel="stylesheet" i]').length + $('style').length,
    images: images.length,
    modernImages: $('picture').length > 0 || $('img[srcset]').length > 0 || /\.(webp|avif)\b/i.test(lowerHtml),
    h1: $('h1').length > 0,
    openGraph: $('meta[property^="og:"]').length > 0,
    structuredData: $('script[type="application/ld+json"]').length > 0,
    favicon: $('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').length > 0,
    clickToCall: links.some((href) => /^tel:/i.test(href)),
    whatsappButton: /wa\.me\b|whatsapp\.com\/send|whatsapp:\/\/send/i.test(linkText) || $('[class*="whatsapp" i], [id*="whatsapp" i]').length > 0,
    contactForm: $('form').toArray().some((form) => $(form).find('input[type="email"], input[type="tel"], textarea, input[name*="phone" i], input[name*="mail" i]').length > 0),
    accessibilityStatement: ACCESSIBILITY_STATEMENT.test(footerAndLinks),
    accessibilityWidget: ACCESSIBILITY_WIDGET.test(lowerHtml),
    privacyPolicy: PRIVACY.test(`${$('footer').text()} ${linkText}`),
    emails,
    headings,
    text: text.slice(0, 3000),
    rendered: false,
    mobileOverflow: null,
    renderMs: null,
    lcpMs: null,
    consoleErrors: null,
  };
}
