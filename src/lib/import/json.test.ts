import { describe, expect, it } from 'vitest';
import { foundFields, JSON_EXAMPLE, jsonBatches, jsonKeysOf, parseJsonLeads, unreadFields } from './json';

describe('reading pasted JSON', () => {
  it('reads an array of leads, and one lead on its own', () => {
    const example = parseJsonLeads(JSON_EXAMPLE);
    expect(example).toMatchObject({ kind: 'ok', fixed: false });
    expect(example.kind === 'ok' && example.items).toHaveLength(2);
    expect(parseJsonLeads('{ "name": "יוסי שיפוצים", "phone": "054-1234567" }')).toMatchObject({ kind: 'ok', items: [{ name: 'יוסי שיפוצים' }] });
    expect(parseJsonLeads('  \n ')).toEqual({ kind: 'empty' });
  });

  it('fixes typographic quotes and a comma left before ] or }', () => {
    const pasted = parseJsonLeads('[{ “name”: “יוסי שיפוצים”, “phone”: “054-1234567”, }, ]');
    expect(pasted).toEqual({ kind: 'ok', items: [{ name: 'יוסי שיפוצים', phone: '054-1234567' }], fixed: true });
  });

  it('says what is wrong, and where', () => {
    expect(parseJsonLeads('[{ "name": "יוסי", "phone": 0541234567 }]')).toEqual({
      kind: 'error',
      message: 'מספר טלפון שמתחיל ב-0 צריך מירכאות, כמו "phone": "054-1234567".',
    });
    expect(parseJsonLeads('[{ "name": "יוסי"')).toEqual({ kind: 'error', message: 'ה-JSON נקטע באמצע: חסרה סגירה, ] או }.' });
    const missingComma = parseJsonLeads('[\n  { "name": "יוסי" }\n  { "name": "רון" }\n]');
    expect(missingComma).toMatchObject({ kind: 'error', message: expect.stringMatching(/^ה-JSON לא תקין בשורה 3, תו \d+\./) });
    expect(parseJsonLeads('"יוסי"')).toMatchObject({ kind: 'error', message: expect.stringContaining('צריך מערך של לידים') });
    expect(parseJsonLeads('[]')).toEqual({ kind: 'error', message: 'המערך ריק: אין בו לידים.' });
  });

  it('reads what an export wraps its leads in, and JSON Lines', () => {
    expect(parseJsonLeads('{ "meta": { "count": 1 }, "data": [{ "title": "מספרה", "phone": "054-1234567" }] }')).toMatchObject({
      kind: 'ok',
      items: [{ title: 'מספרה' }],
    });
    expect(parseJsonLeads('{"title": "א", "phone": "054-1111111"}\n{"title": "ב", "phone": "054-2222222"}\n')).toMatchObject({
      kind: 'ok',
      items: [{ title: 'א' }, { title: 'ב' }],
      fixed: false,
    });
  });

  it('shows which field was found where, and names the fields that will not be read', () => {
    const scrape = [
      { title: 'המספרה אליהו', phone: '+972 50-909-4047', categoryName: 'מספרה', categories: ['מספרה'], street: 'בית וגן 42', city: 'ירושלים', totalScore: 4.8, state: null, countryCode: 'IL' },
      { title: 'בלאגניסט', phone: '+972 50-757-4742', website: 'https://cali.example', 'Opening Hours': '9-19' },
    ];
    expect(foundFields(scrape)).toEqual([
      { label: 'שם העסק', keys: ['title'] },
      { label: 'טלפון', keys: ['phone'] },
      { label: 'נישה', keys: ['categoryName', 'categories'] },
      { label: 'אתר', keys: ['website'] },
      { label: 'עיר', keys: ['city'] },
      { label: 'כתובת', keys: ['street'] },
      { label: 'דירוג', keys: ['totalScore'] },
    ]);
    // An empty field isn't worth a word; one with something in it that nothing reads is
    expect(unreadFields(scrape)).toEqual(['countryCode', 'Opening Hours']);
    expect(unreadFields([{ name: 'a', phone: '1', email: 'x', City: 'y', fax: '2' }, 'not a lead'])).toEqual(['fax']);
  });

  it('finds fields named its own way by a file, and the ones chosen by hand', () => {
    const yellowPages = [
      { biz_title: 'נגריית הכרמל', 'טלפון ראשי': '04-8123456', mainCategory: 'נגריות', 'כתובת העסק': 'החרושת 3, חיפה', listingId: 99812 },
      { biz_title: 'מסגריית אבי', 'טלפון ראשי': '052-1234567', mainCategory: 'מסגריות', listingId: 99813 },
    ];
    expect(foundFields(yellowPages)).toEqual([
      { label: 'שם העסק', keys: ['biz_title'] },
      { label: 'טלפון', keys: ['טלפון ראשי'] },
      { label: 'נישה', keys: ['mainCategory'] },
      { label: 'כתובת', keys: ['כתובת העסק'] },
    ]);
    expect(unreadFields(yellowPages)).toEqual(['listingId']);

    // A file whose name and niche hide under keys nothing would guess
    const odd = [{ col1: 'קפה נחת', col2: '02-6250000', col3: 'בתי קפה' }];
    expect(foundFields(odd)).toEqual([{ label: 'טלפון', keys: ['col2'] }]);
    expect(foundFields(odd, { name: 'col1', niche: 'col3' })).toEqual([
      { label: 'שם העסק', keys: ['col1'] },
      { label: 'טלפון', keys: ['col2'] },
      { label: 'נישה', keys: ['col3'] },
    ]);
    expect(unreadFields(odd, { name: 'col1', niche: 'col3' })).toEqual([]);
    expect(jsonKeysOf(odd)).toEqual([
      { key: 'col1', count: 1, example: 'קפה נחת' },
      { key: 'col2', count: 1, example: '02-6250000' },
      { key: 'col3', count: 1, example: 'בתי קפה' },
    ]);
  });

  it('sends a big paste in parts the server takes', () => {
    const items = Array.from({ length: 1200 }, (_, i) => ({ name: `עסק ${i}`, phone: '054-1234567' }));
    expect(jsonBatches(items).map((batch) => batch.length)).toEqual([500, 500, 200]);
    const long = Array.from({ length: 10 }, () => ({ name: 'א', notes: 'ב'.repeat(100_000) }));
    // Hebrew is two bytes a letter: 200 kB each, so seven fit under 1.5 MB
    expect(jsonBatches(long).map((batch) => batch.length)).toEqual([7, 3]);
    expect(jsonBatches([])).toEqual([]);
  });
});
