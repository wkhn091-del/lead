import type { ContactMethod } from '../../types';
import { isValidEmail } from '../email';
import { formatPhone } from '../phone';
import { isValidWebsite } from '../website';

/** Lead fields a pasted value can fill */
export type ImportField = 'name' | 'contactName' | 'phone' | 'email' | 'website' | 'campaign' | 'approach' | 'method' | 'notes';
export type ColumnTarget = ImportField | 'skip';

export const COLUMN_TARGETS: readonly ColumnTarget[] = [
  'name',
  'contactName',
  'phone',
  'email',
  'website',
  'campaign',
  'approach',
  'method',
  'notes',
  'skip',
];

export const TARGET_LABELS: Record<ColumnTarget, string> = {
  name: 'שם העסק',
  contactName: 'איש קשר',
  phone: 'טלפון',
  email: 'אימייל',
  website: 'האתר הנוכחי',
  campaign: 'קמפיין / נישה',
  approach: 'אסטרטגיה',
  method: 'ערוץ מועדף',
  notes: 'הערות',
  skip: 'לא לייבא',
};

/** Lowercase, Hebrew quote marks unified, surrounding punctuation removed: "Status:" reads as "status". */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/[\s_]+/g, ' ')
    .replace(/^[\s"'.,:;!?()[\]{}*#•·\-–—]+|[\s"'.,:;!?()[\]{}*#•·\-–—]+$/g, '');
}

// Column headers, in English and Hebrew, as normalizeWord returns them.
const HEADER_WORDS: Record<Exclude<ColumnTarget, 'notes'>, readonly string[]> & { notes: readonly string[] } = {
  name: [
    'lead', 'lead name', 'leads', 'business', 'business name', 'company', 'company name', 'organization',
    'organisation', 'account', 'account name', 'client', 'client name', 'customer', 'customer name', 'brand',
    'store', 'shop', 'עסק', 'העסק', 'שם העסק', 'שם עסק', 'חברה', 'שם החברה', 'שם חברה', 'לקוח', 'שם הלקוח',
    'שם לקוח', 'ליד', 'שם הליד', 'מותג', 'חנות',
  ],
  contactName: [
    'contact', 'contact name', 'contact person', 'person', 'owner', 'manager', 'decision maker', 'first name',
    'last name', 'surname', 'given name', 'family name', 'איש קשר', 'אשת קשר', 'איש הקשר', 'שם איש קשר',
    'שם איש הקשר', 'בעלים', 'בעל העסק', 'בעלת העסק', 'מנהל', 'מנהלת', 'שם פרטי', 'שם משפחה', 'נציג',
  ],
  phone: [
    'phone', 'phones', 'phone number', 'phone no', 'mobile', 'mobile number', 'mobile phone', 'cell', 'cellphone',
    'cell phone', 'tel', 'telephone', 'number', 'whatsapp', 'whatsapp number', 'contact number', 'טלפון',
    'טלפונים', 'מספר טלפון', 'טל', 'נייד', 'פלאפון', 'סלולרי', 'מספר', 'מס טלפון', "מס' טלפון", 'וואטסאפ',
    'ווטסאפ',
  ],
  email: [
    'email', 'e-mail', 'emails', 'mail', 'email address', 'e-mail address', 'אימייל', 'מייל', 'דוא"ל', 'דואל',
    'דואר אלקטרוני', 'כתובת מייל', 'אי-מייל', 'אי מייל',
  ],
  website: [
    'website', 'web site', 'site', 'web', 'url', 'link', 'homepage', 'domain', 'current website', 'current site',
    'אתר', 'אתר אינטרנט', 'כתובת אתר', 'אתר נוכחי', 'האתר הנוכחי', 'לינק', 'קישור',
  ],
  campaign: [
    'campaign', 'topic', 'niche', 'category', 'tag', 'segment', 'industry', 'batch', 'vertical', 'קמפיין', 'נושא',
    'נישה', 'קטגוריה', 'תחום', 'תגית', 'ענף', 'סגמנט',
  ],
  approach: [
    'approach', 'strategy', 'strategy notes', 'pitch', 'angle', 'script', 'how to talk', 'talking points', 'opener',
    'opening line', 'גישה', 'אסטרטגיה', 'הערות אסטרטגיה', 'איך לדבר', 'זווית', 'פתיח', 'תסריט', 'דגשים',
  ],
  method: [
    'channel', 'method', 'contact method', 'via', 'source', 'lead source', 'ערוץ', 'מקור', 'מקור הליד',
    'דרך פנייה', 'אמצעי קשר', 'פנייה דרך',
  ],
  notes: [
    'notes', 'note', 'comments', 'comment', 'details', 'description', 'remarks', 'info', 'summary', 'next step',
    'next steps', 'follow up', 'הערות', 'הערה', 'פרטים', 'תיאור', 'מידע', 'סיכום', 'סיכום שיחה', 'צעד הבא',
    'המשך טיפול',
  ],
  skip: ['id', '#', 'no', 'row', 'index', 'מס', "מס'", 'מספר סידורי', 'מס סידורי'],
};

/** "Name" alone can mean the business or the person, so it gives way to a business column. */
const LOOSE_NAME_HEADERS = new Set(['name', 'names', 'full name', 'שם', 'שמות', 'שם מלא']);

/** Columns from older sheets that the funnel sets for itself; their values are kept as labelled notes. */
const LABELLED_NOTE_WORDS = [
  'value', 'deal value', 'deal', 'amount', 'price', 'budget', 'quote', 'revenue', 'sum', 'total', 'cost', 'setup fee',
  'retainer', 'monthly retainer', 'mrr', 'hosting', 'סכום', 'מחיר', 'תקציב', 'שווי', 'הצעת מחיר', 'עסקה', 'דמי הקמה',
  'ריטיינר', 'ריטיינר חודשי', 'אחסון', 'status', 'stage', 'state', 'result', 'outcome', 'סטטוס', 'מצב',
  'שלב', 'תוצאה', 'city', 'address', 'עיר', 'כתובת', 'date', 'תאריך',
];

const HEADER_INDEX = new Map<string, ColumnTarget>([
  ...LABELLED_NOTE_WORDS.map((word) => [word, 'notes'] as const),
  ...(Object.entries(HEADER_WORDS) as [ColumnTarget, readonly string[]][]).flatMap(([target, list]) =>
    list.map((word) => [word, target] as const),
  ),
]);
const NOTE_HEADERS = new Set(HEADER_WORDS.notes);

export interface HeaderMatch {
  target: ColumnTarget;
  /** True for "Name" alone, which becomes the contact when a business column exists */
  loose: boolean;
}

/** Recognizes a column header such as "Phone", "שם העסק" or "Deal value (₪)". */
export function headerField(cell: string): HeaderMatch | null {
  const word = normalizeWord(cell.replace(/\([^)]*\)|\[[^\]]*\]|[₪$*]/g, ' '));
  if (!word || word.length > 40) return null;
  if (LOOSE_NAME_HEADERS.has(word)) return { target: 'name', loose: true };
  const target = HEADER_INDEX.get(word);
  return target ? { target, loose: false } : null;
}

/** A real notes column, whose values need no label */
export const isNotesHeader = (cell: string) => NOTE_HEADERS.has(normalizeWord(cell));

const CHANNEL_WORDS: Record<ContactMethod, readonly string[]> = {
  whatsapp: [
    'whatsapp', 'whats app', 'whatsup', 'wa', 'wapp', 'message', 'messages', 'text', 'sms', 'chat', 'וואטסאפ',
    'ווטסאפ', 'וואצאפ', 'ווצאפ', 'וטסאפ', 'הודעה', 'הודעות', "צ'אט", 'מסרון',
  ],
  call: [
    'call', 'calls', 'phone', 'phone call', 'cold call', 'cold calling', 'calling', 'tel', 'telephone', 'שיחה',
    'שיחות', 'טלפון', 'שיחת טלפון', 'שיחה קרה', 'טלפוני',
  ],
};

function phraseMatcher<T extends string>(table: Record<T, readonly string[]>) {
  const exact = new Map<string, T>();
  for (const [key, list] of Object.entries(table) as [T, readonly string[]][]) {
    for (const phrase of list) exact.set(phrase, key);
  }
  const longestFirst = [...exact.keys()].sort((a, b) => b.length - a.length);

  /** Exact phrases, plus "No answer x2" or "Won - paid" when prefixes are allowed */
  return (text: string, allowPrefix = true): T | null => {
    const word = normalizeWord(text);
    if (!word) return null;
    const hit = exact.get(word);
    if (hit) return hit;
    if (!allowPrefix) return null;
    const prefix = longestFirst.find((phrase) => phrase.length >= 3 && word.startsWith(`${phrase} `));
    return prefix ? (exact.get(prefix) ?? null) : null;
  };
}

export const matchChannel = phraseMatcher(CHANNEL_WORDS);

const WEBSITE_IN_TEXT =
  /(?:https?:\/\/[^\s|,;()]+|www\.[^\s|,;()]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.il|org\.il|com|net|org|io|co|il|info|biz|shop|store|online|site|app|example)(?:\/[^\s|,;()]*)?)/gi;

/** A website in a cell that holds only the website */
export function readWebsite(text: string): string | null {
  const value = text.trim().replace(/[.,;]$/, '');
  return value && !value.includes('@') && !/\s/.test(value) && isValidWebsite(value) ? value : null;
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** The first valid email address in the text. */
export function findEmail(text: string): string | null {
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const email = match[0].replace(/^[.'-]+/, '');
    if (isValidEmail(email)) return email;
  }
  return null;
}

/**
 * Reads one phone number and returns it formatted, or null.
 * Strict (free text): it must start with +, 00, 972 or a local 0.
 * Loose (a phone column): also restores the 0 that Excel drops from Israeli numbers.
 */
export function readPhone(text: string, loose = false): string | null {
  const raw = text.trim();
  if (!raw || raw.length > 40 || /\p{L}/u.test(raw)) return null;
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}(?!\d)/.test(raw)) return null; // a date
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return international(digits, raw);
  if (digits.startsWith('00')) return international(digits.slice(2), raw.replace(/^[^\d]*00/, '+'));
  if (digits.startsWith('972') && (digits.length === 11 || digits.length === 12)) {
    return formatPhone(`0${digits.slice(3)}`);
  }
  if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) return formatPhone(digits);
  if (loose) {
    if (/^(?:5\d{8}|7\d{8}|[2-489]\d{7})$/.test(digits)) return formatPhone(`0${digits}`);
    if (digits.length >= 9 && digits.length <= 15) return digits;
  }
  return null;
}

function international(digits: string, written: string): string | null {
  if (digits.length < 8 || digits.length > 15) return null;
  // Known lengths stop a number from swallowing the next one ("+972 50-000-0105 12k").
  if (digits.startsWith('972')) {
    const national = digits.slice(3).replace(/^0/, '');
    return national.length === 8 || national.length === 9 ? formatPhone(`0${national}`) : null;
  }
  if (digits.startsWith('1') && digits.length !== 11) return null;
  return written.replace(/[^\d+()\-.\s]/g, '').replace(/\s+/g, ' ').trim();
}

const PHONE_RUN = /\+?\(?\d[\d\s().\-]{6,}\d\)?/g;

/** Phone numbers inside a line of text, with their positions. */
export function findPhones(text: string): { phone: string; start: number; end: number }[] {
  const found: { phone: string; start: number; end: number }[] = [];
  for (const run of text.matchAll(PHONE_RUN)) {
    const base = run.index ?? 0;
    const tokens = [...run[0].matchAll(/\S+/g)].map((token) => {
      const start = base + (token.index ?? 0);
      return { start, end: start + token[0].length };
    });
    // Neighbouring numbers can run together ("Store 12 050-000-0142"), so take the longest valid stretch.
    let i = 0;
    while (i < tokens.length) {
      let next = i + 1;
      for (let j = tokens.length; j > i; j--) {
        const phone = readPhone(text.slice(tokens[i].start, tokens[j - 1].end));
        if (phone) {
          found.push({ phone, start: tokens[i].start, end: tokens[j - 1].end });
          next = j;
          break;
        }
      }
      i = next;
    }
  }
  return found;
}

/** Pulls emails, websites and phone numbers out of a line, leaving a | where each one was. */
export function takeContacts(line: string): { phones: string[]; emails: string[]; websites: string[]; rest: string } {
  const emails: string[] = [];
  const websites: string[] = [];
  let rest = line
    .replace(EMAIL_IN_TEXT, (match) => {
      const email = match.replace(/^[.'-]+/, '');
      if (!isValidEmail(email)) return match;
      emails.push(email);
      return ' | ';
    })
    .replace(WEBSITE_IN_TEXT, (match) => {
      const website = readWebsite(match);
      if (!website) return match;
      websites.push(website);
      return ' | ';
    });
  const phones = findPhones(rest);
  for (const { start, end } of [...phones].reverse()) rest = `${rest.slice(0, start)} | ${rest.slice(end)}`;
  return { phones: phones.map(({ phone }) => phone), emails, websites, rest };
}

const BUSINESS_WORDS = new Set([
  'ltd', 'inc', 'llc', 'co', 'corp', 'group', 'studio', 'studios', 'shop', 'store', 'clinic', 'restaurant', 'cafe',
  'café', 'coffee', 'bakery', 'hotel', 'office', 'center', 'centre', 'salon', 'gym', 'law', 'agency', 'tours',
  'travel', 'charters', 'press', 'winery', 'dental', 'auto', 'garage', 'accounting', 'realty', 'estate', 'design',
  'media', 'solutions', 'services', 'academy', 'school', 'spa', 'pub', 'kitchen', 'foods', 'market', 'pharmacy',
  'boutique', 'gallery', 'farm', 'dairy', 'motors', 'electric', 'plumbing', 'construction', 'insurance',
  'photography', 'flowers', 'yoga', 'pilates', 'fitness', 'kayak', 'catering', 'events', 'roasters',
  'physiotherapy', 'steakhouse', 'furniture',
  'בע"מ', 'בעמ', 'סטודיו', 'חנות', 'קליניקה', 'מרפאה', 'מרפאת', 'מסעדה', 'מסעדת', 'קפה', 'מאפייה', 'מאפיית',
  'מלון', 'משרד', 'מרכז', 'מספרה', 'סלון', 'קבוצת', 'סוכנות', 'יקב', 'מוסך', 'נדל"ן', 'נדלן', 'עיצוב', 'צילום',
  'פרחי', 'פרחים', 'הנהלת', 'ביטוח', 'יוגה', 'פילאטיס', 'גלריה', 'מעדניית', 'קייטרינג', 'אירועים', 'שיווק',
  'חשמל', 'אינסטלציה',
]);

export function isBusinessLike(text: string): boolean {
  return normalizeWord(text)
    .split(/[\s-]+/)
    .some((word) => BUSINESS_WORDS.has(word.replace(/[.,]$/, '')));
}

const NAME_PARTICLES = new Set(['ben', 'bar', 'bat', 'bin', 'de', 'da', 'del', 'van', 'von', 'al', 'el', 'abu', 'ibn']);
/** Hebrew words that start a note rather than a name */
const NOTE_WORDS = new Set([
  'רוצה', 'רוצים', 'רוצות', 'צריך', 'צריכים', 'מעוניין', 'מעוניינים', 'לחזור', 'להתקשר', 'אתר', 'עם', 'של', 'את',
  'לא', 'כן', 'יש', 'אין', 'פגישה', 'הצעה', 'שלחתי', 'דיברנו', 'דיברתי', 'ביום', 'מחר', 'שבוע', 'אחרי', 'לפני',
]);

/** "Moshe Azulay", "Dr. Avi Peretz", "אמיר": short, capitalized in English, no digits. */
export function isPersonName(text: string): boolean {
  if (!text || text.length > 40 || /[\d@:]/.test(text) || isBusinessLike(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 4) return false;
  if (/[A-Za-z]/.test(text)) {
    return words.every((word) => /^[A-Z]/.test(word.replace(/^[^A-Za-z]+/, '')) || NAME_PARTICLES.has(word.toLowerCase()));
  }
  return words.length <= 3 && !words.some((word) => NOTE_WORDS.has(word));
}
