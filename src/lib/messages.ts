import type { Lead } from '../types';
import { pipelineStatus } from './stages';

/**
 * Ready-made WhatsApp messages. The WhatsApp button opens the chat with the message for where the lead stands
 * (a first approach to a new lead, a follow-up after a call…), filled in with the lead's details; you read it in
 * WhatsApp and send it yourself. Each one can be edited, and is kept on this device (store/messages.ts).
 */

export type TemplateId = 'intro' | 'missed' | 'after-call' | 'quote' | 'follow-up';

export interface MessageTemplate {
  id: TemplateId;
  label: string;
  text: string;
}

/** What a template can mention, as it's written in it */
export const TEMPLATE_FIELDS = [
  { token: '{איש_קשר}', label: 'השם הפרטי של איש הקשר' },
  { token: '{שם_העסק}', label: 'שם העסק' },
  { token: '{נישה}', label: 'הנישה' },
] as const;

export const DEFAULT_TEMPLATES: readonly MessageTemplate[] = [
  {
    id: 'intro',
    label: 'פנייה ראשונה',
    text: 'שלום {איש_קשר}, כאן סטודיו עומק, אנחנו בונים אתרים לעסקים. ראיתי את {שם_העסק} ורציתי להציע לכם הדמיה חינמית של עמוד הבית לאתר, בלי שום התחייבות. אשמח לשלוח לכם?',
  },
  {
    id: 'missed',
    label: 'אחרי שלא ענה',
    text: 'שלום {איש_קשר}, ניסיתי להשיג אתכם בטלפון. כאן סטודיו עומק, אנחנו בונים אתרים לעסקים, ואשמח להכין ל{שם_העסק} הדמיה חינמית של עמוד הבית. מתי נוח לדבר?',
  },
  {
    id: 'after-call',
    label: 'אחרי שיחה',
    text: 'שלום {איש_קשר}, תודה על השיחה! כמו שדיברנו, אכין ל{שם_העסק} הדמיה של עמוד הבית. אם יש לוגו או תמונות שתרצו שאשתמש בהם, אפשר לשלוח לי כאן.',
  },
  {
    id: 'quote',
    label: 'הצעת מחיר',
    text: 'שלום {איש_קשר}, מצרף את הצעת המחיר לאתר של {שם_העסק}, כמו שסיכמנו. אשמח לענות על כל שאלה.',
  },
  {
    id: 'follow-up',
    label: 'מעקב',
    text: 'שלום {איש_קשר}, רציתי לבדוק אם יצא לכם לעבור על מה ששלחתי. אשמח לשמוע מה דעתכם.',
  },
];

/** The message that fits where the lead stands */
export function templateFor(lead: Pick<Lead, 'stage' | 'activity'>): TemplateId {
  switch (pipelineStatus(lead)) {
    case 'new':
      return 'intro';
    case 'contacted':
      return lead.activity.find((step) => step.type === 'answered' || step.type === 'no_answer')?.type === 'no_answer' ? 'missed' : 'after-call';
    case 'quote':
      return 'quote';
    case 'whatsapp':
    case 'client':
      return 'follow-up';
  }
}

/**
 * The template with the lead's details in it. Without a contact name, "שלום {איש_קשר}," reads "שלום,"; a field the
 * lead doesn't have is left out the same way.
 */
export function fillTemplate(text: string, lead: Pick<Lead, 'name' | 'contactName' | 'campaign'>): string {
  const firstName = lead.contactName.trim().split(/\s+/)[0] ?? '';
  const values: Record<string, string> = { 'איש_קשר': firstName, 'שם_העסק': lead.name.trim(), 'נישה': lead.campaign.trim() };
  return text
    .replace(/( ?)\{(איש_קשר|שם_העסק|נישה)\}/g, (_match, space: string, field: string) => (values[field] ? `${space}${values[field]}` : ''))
    .replace(/ +([,.!?])/g, '$1')
    .trim();
}
