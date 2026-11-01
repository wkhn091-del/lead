import { renderConversation } from '../lib/chat';
import { NO_DEAL } from '../lib/deal';
import { timelineEntryFor } from '../lib/workflow';
import type { Activity, Channel, ChatLine, CoachingReport, ContactMethod, DealTerms, Interaction, Lead, MessageKind, Stage } from '../types';
import { sampleCoaching } from './sampleCoaching';

/** Sample leads carry this id prefix, so the UI can label them and remove them in one go. */
export const SAMPLE_ID_PREFIX = 'sample-';
export const isSampleLead = (lead: Pick<Lead, 'id'>) => lead.id.startsWith(SAMPLE_ID_PREFIX);

/** One message of a mirrored WhatsApp conversation, `minute` minutes into it */
interface ChatScript {
  me?: boolean;
  minute: number;
  text?: string;
  voice?: { seconds: number; transcript: string };
}

/** Something that happened with a lead: a pipeline step, a note or message, or a WhatsApp chat mirrored by the server */
type Event =
  | { step: 'no_answer' | 'answered' | 'advance' | 'archive'; days: number; hour?: number; said?: string; channel?: Channel }
  | { write: MessageKind; days: number; hour?: number; said: string }
  | { chat: ChatScript[]; days: number; hour?: number; minute?: number };

interface Seed {
  /** A stable English slug for the lead's id, and for its sample analysis */
  key: string;
  name: string;
  contact: string;
  /** The 000 block marks these as placeholder numbers. */
  phone: string;
  website?: string;
  campaign: string;
  approach?: string;
  method?: ContactMethod;
  /** What the deal brings in, once it closes */
  deal?: DealTerms;
  /** Days ago it was imported */
  age: number;
  /** Oldest first, in days ago */
  story?: Event[];
}

/** What an automatic transcript looks like once the server adds it to a call (see server/src/transcription) */
const HADAR_TRANSCRIPT = `[Auto-Transcript]
היי דניאל, זה בקשר לאתר. יש לך דקה?
כן, היי. סליחה על יום שלישי, שכחתי לגמרי מהזום. שבוע מטורף.
אין בעיה בכלל. הספקת לחשוב על סנכרון הנכסים?
תשמע, דיברתי עם רונית, השותפה שלי. היא חושבת שעשרים אלף זה הרבה בשביל אתר. יש לנו מישהו שהציע שישה אלף.
מבין. מה כוללת ההצעה שלו?
אני לא בטוח בדיוק. אתר חדש, נראה לי. אתה יכול פשוט לשלוח לי משהו בכתב? נסתכל על זה ביחד.
בטח, אשלח לך הצעה.
מעולה, תודה. נדבר.`;

const SEEDS: Seed[] = [
  {
    key: 'galil-dental', name: 'סטודיו השיניים של הגליל', contact: 'ד"ר אבי פרץ', phone: '054-000-0119', website: 'galil-dental.example', campaign: 'רופאי שיניים', age: 9,
    approach: 'לשאול איך מטופלים חדשים קובעים תור היום. להציע הדמיה חינם של דף הבית, עם זימון תורים אונליין.',
  },
  {
    key: 'smile-line', name: 'מרפאת קו החיוך', contact: 'ד"ר נועה שלו', phone: '052-000-0131', campaign: 'רופאי שיניים', age: 9, story: [{ step: 'no_answer', days: 3 }],
    approach: 'קצר וענייני. חשוב לה להופיע ראשונה בגוגל על השתלות.',
  },
  {
    key: 'tabor-ortho', name: 'אורתודונטיה תבור', contact: 'ד"ר רונן קדוש', phone: '050-000-0147', website: 'tabor-ortho.example', campaign: 'רופאי שיניים', age: 9,
    approach: 'האתר מ-2015 ולא מותאם לנייד. לפתוח בזה.',
  },
  {
    key: 'nof-hagalil-dental', name: 'מרפאת שיניים נוף הגליל', contact: 'ד"ר סמיר', phone: '054-000-0153', campaign: 'רופאי שיניים', age: 9,
    story: [{ step: 'no_answer', days: 4 }, { step: 'no_answer', days: 2, hour: 15 }],
    approach: 'מעדיף שיחה קצרה ולעניין. להציע הדמיה חינם של דף הבית.',
  },
  {
    key: 'kinneret-family-dentistry', name: 'רפואת שיניים משפחתית כנרת', contact: 'ד"ר ליאור בן-עמי', phone: '053-000-0168', campaign: 'רופאי שיניים', age: 9,
    approach: 'שתי מרפאות. רוצה אתר אחד לשתיהן.',
    story: [
      { step: 'advance', days: 5, hour: 12, said: 'דיברתי עם ד"ר ליאור שש דקות. שתי מרפאות (טבריה ומגדל), לכל אחת אתר מיושן משלה. רוצה אתר אחד לשתיהן עם זימון תורים אונליין. שאל על מחיר; אמרתי שזה תלוי במערכת התורים ושנעבור על זה בזום. נקבע זום ליום חמישי ב-10:00.' },
      { write: 'whatsapp', days: 4, hour: 9, said: 'שלחתי את הקישור לזום ושני אתרים של מרפאות שבנינו.' },
    ],
  },
  {
    key: 'zohar-dental', name: 'מרפאת השיניים זוהר', contact: 'ד"ר מאיה לוי', phone: '058-000-0174', campaign: 'רופאי שיניים', age: 9,
    story: [{ step: 'archive', days: 6, hour: 14, said: 'עובדים עם סוכנות דיגיטל בריטיינר חודשי ומרוצים ממנה. החוזה בתוקף עד הקיץ הבא.' }],
  },
  {
    key: 'arbel-olive-press', name: 'בית הבד ארבל', contact: 'משה אזולאי', phone: '050-000-0142', website: 'arbel-olive.example', campaign: 'יצרני מזון', method: 'whatsapp', age: 16,
    approach: 'לדבר על מארזי שי לחגים. מעדיף הודעות קוליות בוואטסאפ.',
    story: [
      {
        days: 3, hour: 9, minute: 12,
        chat: [
          { minute: 0, text: 'בוקר טוב, ראיתי את ההודעה שלך על אתר לבית הבד' },
          { minute: 4, me: true, text: 'בוקר אור משה! רציתי להראות לך איך נראית חנות עם מארזי שי לחגים, הזמנה ומשלוח בלי טלפונים' },
          {
            minute: 9,
            voice: {
              seconds: 38,
              transcript: 'תשמע, לפני החגים אנחנו מוכרים מאות מארזים, הכל בטלפון ובווטסאפ. אם האתר יכול לקחת הזמנות של מארזים עם משלוח זה מעניין. אבל אני לא רוצה משהו שאני צריך לתחזק כל יום.',
            },
          },
          { minute: 15, me: true, text: 'בדיוק בשביל זה: מעדכנים מלאי פעם בשבוע וזהו. מתי נוח לך לשיחה של עשר דקות?' },
          { minute: 47, text: 'אחרי סוכות. עכשיו זה מטורף פה 🫒' },
        ],
      },
    ],
  },
  { key: 'galil-bakery', name: 'מאפיית הגליל', contact: 'אמיר', phone: '054-000-0124', campaign: 'יצרני מזון', method: 'whatsapp', age: 16, story: [{ step: 'no_answer', days: 8 }], approach: 'רוצים הזמנות מראש לשבת. לפתוח בזה.' },
  { key: 'migdal-coffee', name: 'בית הקלייה מגדל', contact: 'גיל אוחנה', phone: '052-000-0110', website: 'migdal-coffee.example', campaign: 'יצרני מזון', age: 16, approach: 'ראה אתר שבנינו. לשאול מה אהב בו.' },
  {
    key: 'levi-family-dairy', name: 'מחלבת משפחת לוי', contact: 'יוסי לוי', phone: '053-000-0244', campaign: 'יצרני מזון', age: 16,
    deal: { setupFee: 13500, monthlyRetainer: 600, hostingYearly: 900 },
    story: [
      { step: 'advance', days: 12, hour: 12, said: 'יוסי ענה בצלצול השני. חנות המשק מוכרת רק בשוק של יום שישי; הוא רוצה הזמנות אונליין עם משלוחים באזור הכנרת. נקבע זום ליום שני.' },
      { step: 'advance', days: 6, hour: 12, said: 'זום עם יוסי ועם שירה, הבת שלו, שתנהל את החנות. הראיתי את האתר של קיאקים בירדן. הקמה ב-13,500 ₪ כולל חנות ואזורי משלוח, 600 ₪ בחודש לתחזוקה ועדכון מוצרים, ודומיין ואחסון ב-900 ₪ לשנה. שירה שאלה על תשלום בביט: כן. חתם על ההצעה בזמן השיחה.' },
      { write: 'note', days: 5, said: 'חנות משק עם משלוחים. פגישת התנעה ביום ראשון.' },
    ],
  },
  { key: 'golan-steakhouse', name: 'סטקיית הגולן', contact: 'יניב מלכה', phone: '050-000-0105', campaign: 'מסעדות', method: 'whatsapp', age: 4, approach: 'עמוס בצהריים. להתקשר אחרי 15:00 ולסיים בשתי דקות.' },
  { key: 'kinneret-fish-house', name: 'בית הדגים כנרת', contact: 'שלמה ביטון', phone: '053-000-0149', campaign: 'מסעדות', age: 4, approach: 'התפריט משתנה כל שבוע. להציע עמוד תפריט שהוא מעדכן לבד.' },
  {
    key: 'shemesh-hotel', name: 'מלון בוטיק שמש', contact: 'איתי שמש', phone: '058-000-0135', website: 'shemesh-hotel.example', campaign: 'תיירות', age: 23,
    approach: 'מנוע הזמנות וסיור תלת-ממדי בחדרים. הבעלים אישרו תקציב.',
    story: [
      { step: 'no_answer', days: 20 },
      { step: 'advance', days: 2, hour: 12, said: 'איתי ענה. הבעלים אישרו תקציב לאתר חדש ברבעון הזה. הם מפסידים יותר מדי על עמלות של Booking.com ורוצים הזמנות ישירות וסיור תלת-ממדי בחדרים. זום ביום שלישי עם שני הבעלים.' },
    ],
  },
  {
    key: 'yarden-kayak', name: 'קיאקים בירדן', contact: 'טלי דרור', phone: '050-000-0266', campaign: 'תיירות', age: 23,
    deal: { setupFee: 11500, monthlyRetainer: 0, hostingYearly: 750 },
    story: [
      { step: 'advance', days: 20, hour: 12, said: 'טלי רוצה הזמנות אונליין לפני עונת הקיץ.' },
      { step: 'advance', days: 14, hour: 12, said: 'נסגר ב-11,500 ₪: יומן הזמנות וגרסה באנגלית. דומיין ואחסון ב-750 ₪ לשנה. את התחזוקה היא רוצה לעשות לבד בינתיים.' },
    ],
  },
  { key: 'rosh-pina-guesthouse', name: 'בית ההארחה בראש פינה', contact: 'בני כץ', phone: '050-000-0233', campaign: 'תיירות', age: 23, story: [{ step: 'no_answer', days: 10 }, { step: 'no_answer', days: 5, hour: 11 }], approach: 'עובד בעיקר בסופי שבוע. לנסות ביום ראשון בבוקר.' },
  { key: 'hula-birding', name: 'צפרות בעמק החולה', contact: 'נועה פרץ', phone: '053-000-0255', website: 'hula-birding.example', campaign: 'תיירות', age: 23, approach: 'עסק עונתי. לשאול על עונת הנדידה בסתיו.' },
  { key: 'northern-light-photo', name: 'צילום אור צפוני', contact: 'גל בר', phone: '052-000-0288', campaign: 'תיירות', age: 23, story: [{ step: 'archive', days: 15, hour: 14, said: 'עבר לגור בחו"ל.' }] },
  {
    key: 'hadar-real-estate', name: 'הדר נדל"ן', contact: 'דניאל הדר', phone: '052-000-0158', website: 'hadar-realty.example', campaign: 'נדל"ן', age: 30,
    approach: 'רוצה שהנכסים יסתנכרנו אוטומטית מהמערכת שלהם. להביא דוגמאות.',
    story: [
      { step: 'no_answer', days: 14, hour: 10 },
      { step: 'advance', days: 12, hour: 16, said: 'דניאל ענה. שלושה סוכנים, בערך 40 נכסים. האתר בנוי על תבנית של Wix, וכל נכס מוקלד פעמיים: ביד2 ובאתר. הוא רוצה שהנכסים יסתנכרנו מהמערכת שלהם. אמרתי שאפשר וקבענו זום ליום שלישי הבא. הוא שאל כמה זה עולה; אמרתי "בסביבות 20,000" כדי לראות איך יגיב. הוא השתתק, ואז אמר שהוא צריך לדבר עם השותפה שלו.' },
      { step: 'no_answer', days: 7, hour: 10, said: 'דניאל לא הגיע לזום. חיכיתי 10 דקות. אין הודעה.' },
      { write: 'whatsapp', days: 7, hour: 13, said: '"היי דניאל, פספסנו היום. נקבע זמן חדש השבוע?" נקרא, אין תשובה.' },
      { step: 'answered', days: 3, hour: 11, channel: 'call', said: `תפסתי אותו בטלפון. התנצל, אמר ששכח. השותפה שלו, רונית, חושבת ש-20 אלף זה הרבה בשביל אתר; הם משווים לפרילנסר שהציע 6,000. ביקש ש"אשלח משהו בכתב". אמרתי שאשלח הצעת מחיר. לא קבעתי זום חדש.

${HADAR_TRANSCRIPT}` },
      { write: 'note', days: 2, hour: 18, said: 'עדיין צריך לשלוח את ההצעה. לצרף כדוגמה את סנכרון הנכסים מהפרויקט של נוף נדל"ן.' },
    ],
  },
  { key: 'nahum-law', name: 'משרד עורכי הדין נחום', contact: 'תומר נחום', phone: '053-000-0138', campaign: 'שירותים מקצועיים', age: 30, approach: 'טון רשמי. אתר בעברית ובאנגלית.' },
  { key: 'mizrahi-accounting', name: 'מזרחי ראיית חשבון', contact: 'יואב מזרחי', phone: '053-000-0163', campaign: 'שירותים מקצועיים', age: 30, story: [{ step: 'no_answer', days: 9 }], approach: 'עונת הדוחות מתקרבת. להציע אזור אישי ללקוחות באתר.' },
];

const slug = (key: string, index: number) => `${SAMPLE_ID_PREFIX}${index}-${key}`;

const NEXT: Record<Stage, Stage> = { cold_call: 'zoom', zoom: 'closed', closed: 'closed' };

export interface SampleData {
  leads: Lead[];
  /** Every sample lead's timeline */
  interactions: Interaction[];
  /** An example AI analysis, labelled as a sample */
  coaching: CoachingReport[];
}

/** Example leads with their timelines, for trying the CRM. Dates are relative to `now`, so the data always looks current. */
export function createSampleData(now = Date.now()): SampleData {
  const daysAgo = (days: number, hour = 11) => {
    const date = new Date(now - days * 86_400_000);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const interactions: Interaction[] = [];
  const coaching: CoachingReport[] = [];

  const leads = SEEDS.map((seed, index): Lead => {
    const id = slug(seed.key, index);
    const createdAt = daysAgo(seed.age, 9);
    let stage = 'cold_call' as Stage;
    let stageChangedAt = createdAt;
    let attemptCount = 0;
    let lastAttemptAt: string | null = null;
    let archivedAt: string | null = null;
    const steps: Activity[] = [];

    (seed.story ?? []).forEach((event, i) => {
      const at = daysAgo(event.days, event.hour ?? 10 + (i % 6));
      if ('chat' in event) {
        const start = Date.parse(at) + (event.minute ?? 0) * 60_000;
        const chat: ChatLine[] = event.chat.map((line, n) => ({
          id: `${id}-wa-${i}-${n}`,
          at: new Date(start + line.minute * 60_000).toISOString(),
          fromMe: Boolean(line.me),
          type: line.voice ? 'voice' : 'text',
          text: line.text ?? '',
          seconds: line.voice?.seconds ?? null,
          mediaId: null,
          mediaError: null,
          transcript: line.voice?.transcript ?? null,
          edited: false,
          deleted: false,
          canFetch: false,
        }));
        const last = chat[chat.length - 1].at;
        interactions.push({
          id: `wa-${id}-${i}`,
          leadId: id,
          kind: 'whatsapp',
          outcome: null,
          body: renderConversation(chat, seed.contact),
          step: null,
          stage,
          stageTo: null,
          at: last,
          source: 'whatsapp',
          chat,
          updatedAt: last,
        });
        return;
      }
      if ('write' in event) {
        interactions.push({ id: `${id}-entry-${i}`, leadId: id, kind: event.write, outcome: null, body: event.said, step: null, stage, stageTo: null, at, updatedAt: at });
        return;
      }
      const type = ({ no_answer: 'no_answer', answered: 'answered', advance: 'advanced', archive: 'archived' } as const)[event.step];
      const to = type === 'advanced' ? NEXT[stage] : null;
      const step: Activity = { id: `${id}-step-${i}`, type, at, from: stage, to, before: { stageChangedAt, lastAttemptAt, attemptCount } };
      steps.unshift(step);
      interactions.push(timelineEntryFor(step, id, event.said, event.channel));
      if (type === 'no_answer') attemptCount += 1;
      if (type === 'no_answer' || type === 'answered') lastAttemptAt = at;
      if (type === 'archived') archivedAt = at;
      if (to) {
        stage = to;
        stageChangedAt = at;
      }
    });

    const report = sampleCoaching[seed.key];
    if (report) {
      coaching.push({
        id: `${id}-coaching`,
        leadId: id,
        provider: 'sample',
        model: 'ניתוח לדוגמה',
        interactionCount: seed.story?.length ?? 0,
        analysis: report,
        createdAt: daysAgo(1, 9),
      });
    }

    const updatedAt = [steps[0]?.at, createdAt].filter(Boolean).sort().at(-1) as string;
    return {
      id,
      name: seed.name,
      contactName: seed.contact,
      phone: seed.phone,
      email: '',
      website: seed.website ?? '',
      campaign: seed.campaign,
      approach: seed.approach ?? '',
      method: seed.method ?? 'call',
      stage,
      stageChangedAt,
      archivedAt,
      attemptCount,
      lastAttemptAt,
      deal: stage === 'closed' && seed.deal ? { ...seed.deal } : { ...NO_DEAL },
      currency: 'ILS',
      activity: steps,
      createdAt,
      updatedAt,
    };
  });

  return { leads, interactions, coaching };
}

/** Just the sample leads */
export const createSampleLeads = (now = Date.now()) => createSampleData(now).leads;
