// The guard describes what it blocked in English (guard.ts), for the log and its tests. The app is in Hebrew.

/** What the guard blocked (its descriptions in guard.ts), in the words the app shows */
const BLOCKED_HE: Record<string, string> = {
  'a message': 'הודעה',
  'a receipt': 'אישור קבלה',
  'a read receipt (blue ticks)': 'אישור קריאה (וי כחול)',
  'a "played" receipt': 'אישור השמעה',
  'a presence update': 'עדכון "מחובר"',
  'a typing or recording indicator': 'חיווי "מקליד" או "מקליט"',
  'a call action': 'פעולה על שיחה',
  'a chat settings change': 'שינוי בהגדרות של צ׳אט',
  'a media request': 'בקשת מדיה',
  'a device change': 'שינוי במכשירים המקושרים',
  'a group change': 'שינוי בקבוצה',
  'a block or unblock': 'חסימה או ביטול חסימה',
  'a privacy setting change': 'שינוי בהגדרות הפרטיות',
  'a profile status change': 'שינוי בסטטוס',
  'a profile picture change': 'שינוי בתמונת הפרופיל',
  'a disappearing messages change': 'שינוי בהודעות נעלמות',
  'a channel action': 'פעולה בערוץ',
  'a business profile change': 'שינוי בפרופיל העסקי',
  'a catalog change': 'שינוי בקטלוג',
  'a spam report': 'דיווח ספאם',
  'an unreadable frame': 'נתונים לא מזוהים',
  // Held back quietly, without stopping the link
  'an "online" presence': 'סטטוס "מחובר"',
  'a contact token': 'אסימון פרטיות לאיש קשר',
  'a session notice': 'הודעת חיבור',
  'an unreadable acknowledgement': 'אישור לא מזוהה',
  'an unreadable request': 'בקשה לא מזוהה',
  'a GraphQL request': 'בקשת GraphQL',
};
export const blockedInHebrew = (what: string) =>
  BLOCKED_HE[what] ?? (what.endsWith('()') ? `הפעלה של ${what}` : `פעולה יוצאת (${what})`);
