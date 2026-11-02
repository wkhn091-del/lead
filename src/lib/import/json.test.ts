import { describe, expect, it } from 'vitest';
import { JSON_EXAMPLE, jsonBatches, parseJsonLeads, unreadFields } from './json';

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

  it('names the fields that will not be read', () => {
    expect(unreadFields([{ name: 'a', phone: '1', email: 'x', City: 'y' }, { Phone: '2', email: 'z', טלפון: '3' }, 'not a lead'])).toEqual(['email', 'City']);
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
