/**
 * A sample paste for trying the importer, laid out like rows copied from a spreadsheet: one week's batch
 * of dentists. The 000 block marks the phone numbers as placeholders. It shows an English row, a number Excel
 * stored without its leading 0, a lead that is already in the sample data and a repeated row.
 */
export const EXAMPLE_PASTE = [
  ['שם העסק', 'איש קשר', 'טלפון', 'אימייל', 'אתר', 'תחום', 'גישה'],
  ['מרכז השיניים עפולה', 'ד"ר רותם שני', '050-000-0311', 'rotem@afula-dental.example', 'afula-dental.example', 'רופאי שיניים', 'לשאול איך מטופלים קובעים תור היום'],
  ['אורתודונטיה שירה כהן', 'ד"ר שירה כהן', '052-000-0322', '', 'shira-ortho.example', 'רופאי שיניים', 'לפתוח בהדמיה חינם של דף הבית'],
  ['מרפאת שיניים טבריה', 'ד"ר הדס', '054-000-0333', '', '', 'רופאי שיניים', ''],
  ['Levi Dental Clinic', 'Dr. Yossi Levi', '053-000-0344', 'yossi@levidental.example', '', 'רופאי שיניים', ''],
  ['סטודיו השיניים של הגליל', 'ד"ר אבי פרץ', '+972 54-000-0119', '', 'galil-dental.example', 'רופאי שיניים', ''],
  ['מרכז השתלות עמית', 'ד"ר עמית פרץ', '580000355', '', '', 'רופאי שיניים', 'אתר ישן, לא מותאם לנייד'],
  ['חיוך הכנרת', 'ד"ר טלי דרור', '050-000-0366', 'tali@bluelake.example', 'bluelakesmile.example', 'רופאי שיניים', ''],
  ['מרפאת השכונה', 'רונית', '054-000-0377', '', '', 'רופאי שיניים', ''],
  ['מעבדת השיניים הצפונית', 'גל בר', '052-000-0388', 'gal@northernlab.example', '', 'רופאי שיניים', 'עובדים עם מרפאות, לא עם מטופלים'],
  ['מרכז השיניים עפולה', 'ד"ר רותם שני', '050-000-0311', '', '', 'רופאי שיניים', ''],
]
  .map((row) => row.join('\t'))
  .join('\n');
