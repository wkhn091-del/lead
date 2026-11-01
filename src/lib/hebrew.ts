/**
 * Hebrew in the interface: numbers with the right noun form, lists joined the Hebrew way, and the terms the
 * app uses for its sales vocabulary, kept in one place so every screen says the same thing.
 */

const plurals = new Intl.PluralRules('he');
const numbers = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const lists = new Intl.ListFormat('he', { type: 'conjunction' });
const alternatives = new Intl.ListFormat('he', { type: 'disjunction' });

export interface CountForms {
  /** The whole phrase for one: "ליד אחד", "שיחה אחת" */
  one: string;
  /** The noun after a number: "לידים" → "3 לידים" */
  other: string;
  /** The dual some words have: "יומיים", "שעתיים", "פעמיים" */
  two?: string;
  /** For none, when it reads better than "0 …": "אף ליד" */
  zero?: string;
}

/** "ליד אחד", "2 לידים", "יומיים", "12 שיחות" */
export function count(n: number, forms: CountForms): string {
  if (n === 0 && forms.zero) return forms.zero;
  const category = plurals.select(n);
  if (category === 'one') return forms.one;
  if (category === 'two' && forms.two) return forms.two;
  return `${numbers.format(n)} ${forms.other}`;
}

/** "מלקוח אחד", "מ-3 לקוחות", "מיומיים": where a total comes from. A number takes a hyphen after the prefix. */
export function fromCount(n: number, forms: CountForms): string {
  const phrase = count(n, forms);
  return /^\d/.test(phrase) ? `מ-${phrase}` : `מ${phrase}`;
}

/**
 * A left-to-right run inside a Hebrew sentence, such as a setting ("VITE_API_URL=/api") or a file name (".env"),
 * isolated so its punctuation stays in place. For plain strings; in JSX, use <bdi dir="ltr">.
 */
export const ltr = (text: string) => `\u2066${text}\u2069`;

/** "א, ב וג" */
export const joinList = (items: readonly string[]) => lists.format(items);

/** "א, ב או ג" */
export const joinOr = (items: readonly string[]) => alternatives.format(items);

/** Common counted nouns */
export const NOUNS = {
  lead: { one: 'ליד אחד', other: 'לידים' },
  client: { one: 'לקוח אחד', other: 'לקוחות' },
  deal: { one: 'עסקה סגורה אחת', other: 'עסקאות סגורות' },
  call: { one: 'שיחה אחת', other: 'שיחות' },
  business: { one: 'עסק אחד', other: 'עסקים' },
  message: { one: 'הודעה אחת', other: 'הודעות' },
  card: { one: 'כרטיסייה אחת', other: 'כרטיסיות' },
  entry: { one: 'רשומה אחת', other: 'רשומות' },
  day: { one: 'יום אחד', two: 'יומיים', other: 'ימים' },
  week: { one: 'שבוע אחד', two: 'שבועיים', other: 'שבועות' },
  hour: { one: 'שעה אחת', two: 'שעתיים', other: 'שעות' },
  minute: { one: 'דקה אחת', other: 'דקות' },
  time: { one: 'פעם אחת', two: 'פעמיים', other: 'פעמים' },
  row: { one: 'שורה אחת', other: 'שורות' },
  recording: { one: 'הקלטה אחת', other: 'הקלטות' },
  site: { one: 'אתר אחד', other: 'אתרים' },
  objection: { one: 'התנגדות אחת', other: 'התנגדויות' },
  openDeal: { one: 'עסקה פתוחה אחת', other: 'עסקאות פתוחות' },
  renewal: { one: 'חידוש אחד', other: 'חידושים' },
  reminder: { one: 'תזכורת אחת', other: 'תזכורות' },
  request: { one: 'בקשה אחת', other: 'בקשות' },
  change: { one: 'שינוי אחד', other: 'שינויים' },
  second: { one: 'שנייה אחת', two: 'שתי שניות', other: 'שניות' },
} satisfies Record<string, CountForms>;

/** Hebrew letters in a string: for choosing a natural phrasing around names the user typed */
export const hasHebrew = (text: string) => /[֐-׿]/.test(text);
