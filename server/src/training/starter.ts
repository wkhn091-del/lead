/**
 * The starter deck: the objections a web studio hears most on cold calls to small businesses, with answers to
 * practise. The deck starts with these, so there is something to practise from the first day; the AI coach then
 * adds the objections your own prospects raise, with their words, and reuses these keys when it hears one.
 *
 * They are the common objections, not counted from anyone's calls, and the answers are suggestions to make your
 * own. What they offer is the studio's real offer (the free homepage mockup, a landing page to start with), and
 * nothing in them claims clients, results, numbers or payment terms. A deck already saved takes new wording from
 * here (TrainingStore.rewordCommon), on every card no lead of yours has raised.
 *
 * Plain data with no imports: the app (src/data/starterDeck.ts) uses the same cards when it runs without the
 * server.
 */

export interface StarterCard {
  key: string;
  category: 'price' | 'timing' | 'trust' | 'need' | 'authority' | 'competition' | 'diy' | 'other';
  objection: string;
  insight: string;
  response: string;
  alternatives: string[];
  followUp: string;
}

/** Most common first */
export const STARTER_CARDS: readonly StarterCard[] = [
  {
    key: 'already-have-website',
    category: 'need',
    objection: 'יש לי כבר אתר.',
    insight: 'הרבה בעלי עסקים לא בודקים איך האתר שלהם נראה בטלפון, ואם הוא מביא פניות. "יש לי אתר" לא אומר שהוא עובד בשבילם.',
    response:
      'מעולה, אז יש על מה לעבוד. שאלה אחת: כמה פניות בחודש הוא מביא לך? אם התשובה היא "לא הרבה", זה בדיוק מה שאני בודק. אני יכול להכין לך הדמיה של דף הבית, בחינם ובלי התחייבות.',
    alternatives: [
      'פתחתי אותו מהטלפון לפני שהתקשרתי. רוצה לשמוע מה לקוח רואה בשלוש השניות הראשונות?',
      'מצוין. מתי הוא עודכן לאחרונה, ומי מטפל בו היום?',
    ],
    followUp: 'כמה פניות בחודש מגיעות היום מהאתר?',
  },
  {
    key: 'send-on-whatsapp',
    category: 'other',
    objection: 'תשלח לי משהו בוואטסאפ, ואני אסתכל.',
    insight: 'הרבה פעמים זו דרך מנומסת לסיים את השיחה. חומר שנשלח בלי שיחת המשך ביומן נוטה להיעלם.',
    response:
      'בשמחה. כדי שזה יהיה עליך ולא עוד הודעה, אכין הדמיה קצרה של האתר שלך ונעבור עליה ביחד ברבע שעה. מתאים לך מחר בבוקר, או שעדיף אחר הצהריים?',
    alternatives: ['בטח. מה הכי חשוב שיהיה שם, כדי שתגיד כן?', 'אשלח עוד היום. מתי נדבר על זה, כדי שזה לא ילך לאיבוד בין ההודעות?'],
    followUp: 'מתי נוח לך שנעבור על זה ביחד?',
  },
  {
    key: 'too-expensive',
    category: 'price',
    objection: 'זה יקר לי.',
    insight: 'המחיר נשמע גבוה כשעוד לא ברור מה הוא מחזיר. הרבה פעמים זו בקשה להבין את הערך, ולא סירוב.',
    response:
      'מבין. בוא נסתכל על זה מהצד השני: כמה שווה לך לקוח חדש אחד? אם האתר מביא לך כמה כאלה, הוא מחזיר את עצמו. ואת ההדמיה של דף הבית אתה רואה לפני שאתה מחליט, בלי לשלם כלום.',
    alternatives: ['יקר לעומת מה? ספר לי מה ראית, ואראה לך מה ההבדל בפועל.', 'אפשר להתחיל מדף נחיתה אחד שמביא פניות, ולהרחיב כשהוא מוכיח את עצמו.'],
    followUp: 'כמה שווה לך בממוצע לקוח חדש?',
  },
  {
    key: 'call-next-month',
    category: 'timing',
    objection: 'אין לי זמן עכשיו, תתקשר בעוד חודש.',
    insight: 'בעל עסק קטן עמוס, ו"עוד חודש" בלי מועד ביומן נוטה להידחות שוב ושוב.',
    response:
      'לגמרי, אני לא לוקח לך זמן עכשיו. בוא נקבע עשר דקות במועד שנוח לך, ואגיע עם הדמיה מוכנה, ככה לא תצטרך להשקיע בזה כלום. עדיף תחילת השבוע הבא או סופו?',
    alternatives: [
      'בטח. רק משפט אחד: אם הייתי מראה לך מה לקוח רואה כשהוא מחפש אותך בטלפון, ומה הייתי משנה, היה שווה לך עשר דקות?',
      'אין בעיה. מה משתנה בעוד חודש, שיהיה לך יותר פנוי אז?',
    ],
    followUp: 'איזה יום ושעה נוחים לך לעשר דקות?',
  },
  {
    key: 'word-of-mouth',
    category: 'need',
    objection: 'יש לי מספיק עבודה מפה לאוזן.',
    insight: 'הרבה פעמים, גם מי שקיבל המלצה בודק את העסק בגוגל לפני שהוא מתקשר. אתר חלש מוריד ממה שההמלצה כבר בנתה.',
    response:
      'זה הכי טוב שיש. רק שהרבה פעמים, גם מי שקיבל עליך המלצה מחפש אותך בגוגל לפני שהוא מתקשר. אם מה שהוא מוצא לא משדר את הרמה שלך, יש כאלה שפשוט לא מרימים טלפון.',
    alternatives: ['האתר לא בא להחליף את ההמלצות. הוא דואג שאף המלצה לא תלך לאיבוד בדרך.', 'כשיש מספיק עבודה, אפשר לבחור לקוחות. אתר טוב נותן לך יותר מה לבחור.'],
    followUp: 'מה אנשים מוצאים היום כשהם מחפשים את העסק שלך בגוגל?',
  },
  {
    key: 'social-is-enough',
    category: 'need',
    objection: 'יש לי עמוד בפייסבוק ובאינסטגרם, זה מספיק.',
    insight: 'הרשתות טובות למי שכבר מכיר את העסק. מי שמחפש בגוגל שירות כזה באזור מגיע בעיקר לאתרים ולכרטיסי עסק, ולא לפוסטים.',
    response:
      'הרשתות מעולות למי שכבר עוקב אחריך. אבל מי שמחפש עכשיו בגוגל את מה שאתה עושה, באזור שלך, מגיע בעיקר לאתרים ולא לפוסטים. האתר מביא את מי שעוד לא מכיר אותך.',
    alternatives: [
      'כמה מהלקוחות החדשים שלך הגיעו בחודש האחרון מהפייסבוק?',
      'האתר לא מחליף את העמוד שלך, הוא מחבר אליו: מי שמגיע מגוגל רואה גם את מה שאתה מעלה שם.',
    ],
    followUp: 'מה מופיע היום כשמחפשים בגוגל את מה שאתה עושה באזור שלך?',
  },
  {
    key: 'where-got-number',
    category: 'trust',
    objection: 'מאיפה השגת את המספר שלי?',
    insight:
      'שאלה טבעית בשיחה קרה. תשובה ישירה, עם המקור האמיתי, בונה אמון ומחזירה את השיחה למה שחשוב. הנוסח כאן לעסק שמצאת בגוגל מפות; אם המספר הגיע ממקום אחר, אומרים מאיפה.',
    response:
      'מגוגל, מכרטיס העסק שלך. ראיתי את האתר כשחיפשתי עסקים בתחום שלך באזור, ושמתי לב לכמה דברים שאפשר לשפר. יש לך דקה שאספר?',
    alternatives: [
      'הוא מופיע בכרטיס העסק שלך בגוגל מפות. אני מתקשר כי ראיתי באתר משהו שכדאי שתדע.',
      'מגוגל. אני בונה אתרים לעסקים באזור, ולפני שאני מתקשר אני תמיד מסתכל על האתר.',
    ],
    followUp: 'אתה מטפל באתר בעצמך, או מישהו אחר?',
  },
  {
    key: 'have-a-web-guy',
    category: 'competition',
    objection: 'יש לי כבר מישהו שמטפל לי באתר.',
    insight: 'זה לא "לא" אליך, זה "לא" להחלפה עכשיו. הרבה פעמים מי שמטפל רק מתחזק, ואף אחד לא בודק אם האתר מביא פניות.',
    response:
      'מצוין שיש מי שמטפל, ואני לא בא להחליף אף אחד. רק שאלה: מתי מישהו הראה לך לאחרונה כמה פניות האתר הביא? אם תרצה, אעשה לך בדיקה קצרה, ותחליט אם יש בה משהו.',
    alternatives: ['כיף לשמוע. מה הוא עושה הכי טוב בשבילך?', 'אין טעם להחליף סתם. אפשר שאחזור אליך בעוד כמה חודשים, לראות אם משהו השתנה?'],
    followUp: 'מה הדבר האחרון שהוא שינה באתר?',
  },
  {
    key: 'need-partner',
    category: 'authority',
    objection: 'אני צריך לדבר עם השותף.',
    insight: 'ההחלטה משותפת. כשמוכרים רק לאחד השותפים, השני שומע את זה מכלי שני ובקיצור.',
    response:
      'ברור, זו החלטה של שניכם. בוא נקבע רבע שעה עם שניכם, ככה הוא ישאל את השאלות שלו ישירות ולא תצטרך להסביר במקומי. מתי שניכם פנויים?',
    alternatives: ['מה אתה חושב שהוא ישאל? בוא נוודא שיש לך את התשובות.', 'ואם זה היה תלוי רק בך, מה היית אומר?'],
    followUp: 'מתי שניכם פנויים השבוע לרבע שעה?',
  },
  {
    key: 'burned-before',
    category: 'trust',
    objection: 'כבר שילמתי פעם על אתר, ולא יצא מזה כלום.',
    insight: 'החשש הוא לא מאתר, אלא מלשלם שוב ולהישאר בלי תוצאות. צריך להראות איך רואים תוצאה לפני שמתחייבים.',
    response:
      'מבין לגמרי, וזה קורה. הרבה פעמים זה כי בנו "אתר יפה" ולא משהו שמביא פניות. אצלי קודם רואים הדמיה ומדברים על מאיפה יגיעו הפניות, ומחליטים רק אחרי שרואים בדיוק מה מקבלים.',
    alternatives: [
      'מה בדיוק לא עבד שם? ככה אדע מה לעשות אחרת.',
      'אני יכול להראות לך עבודות לדוגמה שבניתי, ולהכין לך הדמיה של דף הבית שלך, כדי שתראה בדיוק מה מקבלים לפני שמחליטים.',
    ],
    followUp: 'מה הכי איכזב אותך בפעם הקודמת?',
  },
  {
    key: 'relative-builds-it',
    category: 'diy',
    objection: 'האחיין שלי בונה לי אתר.',
    insight: 'הרבה פעמים זה פרויקט שנמשך חודשים ונתקע, ואף אחד לא רוצה לפגוע במשפחה. קשה להגיד את זה בקול.',
    response:
      'יופי שיש מישהו במשפחה. שאלה כנה: כמה זמן זה כבר בעבודה? אם זה נתקע, אני יכול להכין לך הדמיה של דף הבית, ותראה אם זה הכיוון, בלי שאף אחד ייעלב.',
    alternatives: ['מצוין. מתי הוא מתכנן לעלות לאוויר?', 'אם תרצה, אעבור על מה שהוא בנה ואגיד לך בכנות מה חסר כדי שזה יביא לקוחות.'],
    followUp: 'מתי האתר אמור לעלות?',
  },
  {
    key: 'diy-builder',
    category: 'diy',
    objection: 'אני יכול לבנות אתר לבד בוויקס בכמה שקלים.',
    insight: 'נכון שאפשר, ובעל העסק יודע את זה. מה שהוא לא סופר זה את הזמן שלו, ואת הפניות שהולכות לאיבוד באתר שלא בנוי למכור.',
    response:
      'נכון, ואני לא בא להתחרות בזה. ההבדל הוא לא בכלי אלא במה שבונים: אתר שבנוי להביא פניות מהטלפון ולהופיע בגוגל, בלי שבועות של ערבים שלך. כמה שווים לך הערבים האלה?',
    alternatives: [
      'לגמרי. אם תרצה, אגיד לך שלושה דברים שחייבים להיות באתר שלך, בין אם תבנה לבד ובין אם איתי.',
      'יש לך זמן לזה עכשיו, כשהעסק רץ?',
    ],
    followUp: 'כמה זמן היית מעריך שזה ייקח לך לבנות לבד?',
  },
];

export const STARTER_KEYS: readonly string[] = STARTER_CARDS.map((card) => card.key);

type Wording = Pick<StarterCard, 'category' | 'objection' | 'insight' | 'response' | 'alternatives' | 'followUp'>;

/** A card's wording, as saved: what rewordCommon compares and writes */
export const wordingOf = ({ category, objection, insight, response, alternatives, followUp }: Wording): Wording => ({
  category,
  objection,
  insight,
  response,
  alternatives: [...alternatives],
  followUp,
});

/** True when a saved card already reads the way the starter card does */
export function sameWording(saved: Wording, card: Wording): boolean {
  return (
    saved.category === card.category &&
    saved.objection === card.objection &&
    saved.insight === card.insight &&
    saved.response === card.response &&
    saved.followUp === card.followUp &&
    saved.alternatives.length === card.alternatives.length &&
    saved.alternatives.every((item, index) => item === card.alternatives[index])
  );
}
