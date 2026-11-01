import { z } from 'zod';
import { DEFAULT_BUSINESS_CONTEXT, honestyRule } from '../coach/prompt.js';
import type { DiscoveredPlace, SiteSignals } from './types.js';

/**
 * The need score, 1–5: how much a business needs a new website.
 *   5  no working website (none, a social or directory page, a dead or placeholder site)
 *   4  extremely outdated or failing on phones
 *   3  works, but dated or generic, missing basics
 *   2  decent and reasonably modern, with a few gaps
 *   1  premium and modern: not a prospect
 * Sites without a working homepage get 5 from the rules alone. Working sites are scored by the AI from the
 * signals, the page text and (with the browser on) a phone screenshot; without the AI, by the rules below.
 */

export const NEED_SCORES = [1, 2, 3, 4, 5] as const;

const seconds = (ms: number) => (ms / 1000).toLocaleString('he-IL', { maximumFractionDigits: 1 });

/** Not built for phones: no viewport setting, or the layout spills past the screen */
export const notMobileFriendly = (signals: SiteSignals) => !signals.viewport || signals.mobileOverflow === true;

/** Slow by what a visitor feels: the main content, the page, or the server's first answer */
export function slowness(signals: SiteSignals): number | null {
  if (signals.lcpMs !== null && signals.lcpMs > 4000) return signals.lcpMs;
  if (signals.renderMs !== null && signals.renderMs > 7000) return signals.renderMs;
  if (signals.loadMs !== null && signals.loadMs > 6000) return signals.loadMs;
  if (signals.responseMs !== null && signals.responseMs > 2500) return signals.responseMs;
  return null;
}

/** The score the signals alone give a working site (1–4), and the reasons behind it, in Hebrew */
export function ruleScore(signals: SiteSignals, now: Date): { score: number; reasons: string[] } {
  let points = 1;
  const reasons: string[] = [];

  if (!signals.viewport) {
    points += 2.5;
    reasons.push('האתר לא מותאם לטלפונים: בנייד מוצג האתר של המחשב, מוקטן');
  } else if (signals.mobileOverflow) {
    points += 1.5;
    reasons.push('בטלפון האתר גולש מהמסך וצריך לגלול הצידה');
  }
  if (signals.legacy.length) {
    points += Math.min(2, signals.legacy.length);
    reasons.push(`טכנולוגיה ישנה: ${signals.legacy.slice(0, 3).join(', ')}`);
  }
  const age = signals.copyrightYear ? now.getFullYear() - signals.copyrightYear : null;
  if (age !== null && age >= 4) {
    points += age >= 6 ? 1.5 : 1;
    reasons.push(`שורת זכויות היוצרים נעצרה ב-${signals.copyrightYear}`);
  }
  if (!signals.https) {
    points += 1;
    reasons.push('האתר בלי HTTPS, והדפדפן מסמן אותו "לא מאובטח"');
  }
  const slow = slowness(signals);
  if (slow !== null) {
    points += 1;
    reasons.push(`האתר איטי: כ-${seconds(slow)} שניות עד שהעמוד מוכן`);
  }
  if (!signals.clickToCall && !signals.whatsappButton) {
    points += 0.5;
    reasons.push('אין כפתור חיוג או וואטסאפ לפונים מהטלפון');
  }
  if (!signals.accessibilityStatement) {
    points += 0.5;
    // The law asks for one on a business's site, but small businesses can be exempt, so it's said that way
    reasons.push('אין הצהרת נגישות. החוק מחייב אותה באתר של עסק, אלא אם העסק פטור (למשל עסק קטן)');
  }
  const clean = signals.modern && signals.viewport && !signals.mobileOverflow && signals.https && slow === null && !signals.legacy.length;
  if (clean) {
    points -= 1;
    const builtWith = signals.tech.find((name) => /Next\.js|Nuxt|Astro|Gatsby|Remix|SvelteKit|Framer|Webflow/.test(name));
    reasons.unshift(`אתר עדכני${builtWith ? ` שבנוי ב-${builtWith}` : ''}, מהיר ומותאם לטלפון`);
  }

  let score = points < 1 ? 1 : points <= 1.5 ? 2 : points < 3 ? 3 : 4;
  // Not made for phones is a 4 whatever else is right (most visitors arrive on a phone).
  if (!signals.viewport) score = 4;
  if (!reasons.length) reasons.push('האתר תקין ומותאם לטלפון, בלי חוסרים בולטים');
  return { score, reasons: reasons.slice(0, 4) };
}

const LANGUAGE_NAME = { he: 'Hebrew (natural spoken Israeli Hebrew for the pitch)', en: 'English' } as const;

/** The AI's answer */
export const SiteAssessment = z.object({
  score: z.number().int().min(1).max(5),
  verdict: z.string().trim().min(1).max(400),
  reasons: z.array(z.string().trim().min(1).max(400)).min(1).max(8),
  pitch: z.string().trim().min(1).max(800),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type SiteAssessment = z.infer<typeof SiteAssessment>;

/** Every field required and no length limits, so it works with both providers' structured outputs */
export const ASSESSMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'verdict', 'reasons', 'pitch', 'confidence'],
  properties: {
    score: { type: 'integer', enum: [...NEED_SCORES], description: 'The need score, 1–5, by the rubric.' },
    verdict: { type: 'string', description: 'One short line on the site, for a results table.' },
    reasons: {
      type: 'array',
      items: { type: 'string' },
      description: 'Two to four reasons, each pointing to something the seller can check by opening the site.',
    },
    pitch: { type: 'string', description: 'An opening line for a cold call, built on one concrete observation.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

export function assessmentSystemPrompt(language: 'he' | 'en', businessContext: string): string {
  return `You review small-business websites for a seller who builds websites. You decide how much one business needs a new website.

About the seller:
${businessContext.trim() || DEFAULT_BUSINESS_CONTEXT}

Need score:
5 - No working website. Give 5 only if what you see isn't really a website: an error, a blank page, an expired or parked domain, an "under construction" page.
4 - Extremely outdated or failing on phones: not made for phones, very old technology (old WordPress or Joomla versions, table layouts, Flash, legacy Hebrew encodings), a visibly dated design, very slow, or no HTTPS.
3 - Works, but dated or generic: an obvious do-it-yourself template, a weak design or unclear offer, missing basics (click-to-call or WhatsApp, a contact form, an accessibility statement), slow.
2 - Decent and reasonably modern, with a few gaps.
1 - Premium and modern (custom design, a current framework such as Next.js, Framer or Webflow, fast, strong visuals): not a prospect.

Rules:
- Judge only from the evidence given: the signals, the page text, and the phone screenshot when one is attached. Never invent facts about the business or its site.
- Each reason names something the seller can verify by opening the site ("no click-to-call button", "the copyright line stops at 2017", "the menu overflows the phone screen").
- The pitch is one or two natural spoken sentences to open a cold call. Build it on ONE concrete observation from the evidence and offer what the seller offers. Friendly and respectful: no pressure, no exaggeration, never mock their current site.
- ${honestyRule()}
- Never say a site breaks the law or risks a lawsuit: Israel's accessibility rules exempt some businesses, small ones among them. Say what's missing instead.
- Write the verdict, the reasons and the pitch in ${LANGUAGE_NAME[language]}. Keep the verdict under 140 characters and each reason under 120.
- confidence: high when the screenshot and the signals agree; medium with no screenshot; low when the page was thin, partly blocked or contradictory.`;
}

const yesNo = (value: boolean | null) => (value === null ? 'unknown' : value ? 'yes' : 'no');

const PHONE = /(?:\+|\b00)?\d[\d\s().-]{6,16}\d/g;
const EMAIL_ADDRESS = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
/** "2012-2024" is a span of years, not a number */
const YEARS = /^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/;

/**
 * Phone numbers and email addresses on a page stay on this server, like a lead's own details: the AI judges the
 * site, not who to call. A run of 8+ digits (with separators) counts as a number; years and prices are shorter.
 */
export function redactContacts(text: string): string {
  return text
    .replace(EMAIL_ADDRESS, '[email]')
    .replace(PHONE, (match) => (match.replace(/\D/g, '').length >= 8 && !YEARS.test(match.trim()) ? '[phone]' : match));
}

/** The evidence for one business, as the prompt's user message */
export function assessmentPrompt(place: Pick<DiscoveredPlace, 'name' | 'category' | 'rating' | 'reviews'>, signals: SiteSignals, rule: { score: number; reasons: string[] }, hasScreenshot: boolean): string {
  const lines = [
    `Business: ${place.name}${place.category ? ` (${place.category})` : ''}`,
    place.rating !== null ? `Google rating: ${place.rating} from ${place.reviews ?? 0} reviews` : null,
    `Website: ${signals.finalUrl}`,
    '',
    'Signals from the homepage:',
    `- HTTPS: ${yesNo(signals.https)}`,
    `- Viewport set for phones: ${yesNo(signals.viewport)}`,
    `- Layout wider than a phone screen: ${yesNo(signals.mobileOverflow)}`,
    `- Built with: ${signals.tech.join(', ') || 'nothing recognizable'}`,
    `- Signs of age: ${signals.legacy.join(', ') || 'none found'}`,
    `- Copyright year: ${signals.copyrightYear ?? 'not shown'}`,
    `- Server response: ${signals.responseMs ?? '?'} ms; page downloaded in ${signals.loadMs ?? '?'} ms; ${signals.htmlKb ?? '?'} KB of HTML`,
    signals.rendered ? `- In a phone browser: loaded in ${signals.renderMs ?? '?'} ms, largest content at ${signals.lcpMs ?? '?'} ms, ${signals.consoleErrors ?? 0} script errors` : null,
    `- Encoding: ${signals.charset ?? 'unknown'}`,
    `- Click-to-call link: ${yesNo(signals.clickToCall)}; WhatsApp button: ${yesNo(signals.whatsappButton)}; contact form: ${yesNo(signals.contactForm)}`,
    `- Accessibility statement: ${yesNo(signals.accessibilityStatement)}; accessibility widget: ${yesNo(signals.accessibilityWidget)}; privacy policy: ${yesNo(signals.privacyPolicy)}`,
    `- Modern images (WebP/AVIF/srcset): ${yesNo(signals.modernImages)}; Open Graph tags: ${yesNo(signals.openGraph)}; structured data: ${yesNo(signals.structuredData)}; favicon: ${yesNo(signals.favicon)}`,
    `- Title: ${redactContacts(signals.title) || '(none)'}`,
    signals.description ? `- Meta description: ${redactContacts(signals.description)}` : null,
    signals.headings.length ? `- Headings: ${redactContacts(signals.headings.join(' | '))}` : null,
    '',
    `The rules alone score it ${rule.score}: ${rule.reasons.join('; ')}`,
    '',
    '<page_text>',
    redactContacts(signals.text) || '(no readable text)',
    '</page_text>',
    '',
    hasScreenshot
      ? 'Attached: a screenshot of the homepage as it opens on a phone (390 px wide). Weigh how it looks: dated or modern, cluttered or clear, readable or not.'
      : 'No screenshot: judge from the signals and the text.',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/**
 * The final score from the AI's answer. A site that isn't made for phones stays at 4 or above, whatever the
 * AI says, since that alone puts it in the "extremely outdated" group.
 */
export function finalScore(assessment: SiteAssessment, signals: SiteSignals): number {
  return !signals.viewport ? Math.max(4, assessment.score) : assessment.score;
}
