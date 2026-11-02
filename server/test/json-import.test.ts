import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { displayPhone, JSON_IMPORT_LIMIT, phoneKey, planJsonImport } from '../src/leads/json-import.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createMemoryStores } from '../src/stores/memory.js';

/** The format pasted in the app: an array of { name, phone, source, niche, notes } */
const SAMPLE = [
  { name: 'יוסי שיפוצים', phone: '054-1234567', source: 'קמפיין פייסבוק', niche: 'קבלני שיפוצים', notes: 'ביקש לחזור אליו אחרי החגים' },
  { name: 'מוסך הגליל', phone: '0529876543', source: 'חיפוש גוגל', niche: 'מוסכים' },
];

describe('reading pasted JSON', () => {
  it('reads one number however it was written', () => {
    for (const written of ['054-1234567', '0541234567', '054 123 4567', '+972 54-123-4567', '+972 054-123-4567', '00972541234567', '972541234567', '541234567']) {
      expect(phoneKey(written, '972'), written).toBe('972541234567');
    }
    expect(phoneKey('03-1234567', '972')).toBe('97231234567');
    expect(phoneKey('1-800-123-456', '972')).toBe('9721800123456');
    for (const notANumber of ['', '123', '054-123', '054-1234567890', 'אין', '12345678']) {
      expect(phoneKey(notANumber, '972'), notANumber).toBeNull();
    }
    expect(phoneKey('+1 212 555 0100', '972')).toBe('12125550100');
  });

  it('writes numbers the way the app shows them', () => {
    expect(displayPhone('972541234567')).toBe('054-123-4567');
    expect(displayPhone('972771234567')).toBe('077-123-4567');
    expect(displayPhone('97231234567')).toBe('03-123-4567');
    expect(displayPhone('9721800123456')).toBe('1-800-123-456');
    expect(displayPhone('12125550100')).toBe('+12125550100');
  });

  it('turns name, phone, niche, source and notes into a lead', () => {
    const plan = planJsonImport(SAMPLE, [], '972');
    expect(plan.skipped).toEqual([]);
    expect(plan.ignoredFields).toEqual([]);
    expect(plan.leads).toEqual([
      { index: 0, name: 'יוסי שיפוצים', phone: '054-123-4567', campaign: 'קבלני שיפוצים', note: 'מקור: קמפיין פייסבוק\nביקש לחזור אליו אחרי החגים' },
      { index: 1, name: 'מוסך הגליל', phone: '052-987-6543', campaign: 'מוסכים', note: 'מקור: חיפוש גוגל' },
    ]);
  });

  it('skips numbers already in the CRM, in any format, and numbers repeated in the paste', () => {
    const existing = [{ id: 'lead-1', name: 'יוסי שיפוצים', phone: '+972-54-123-4567' }];
    const plan = planJsonImport(
      [
        { name: 'יוסי שיפוצים בע"מ', phone: '0541234567' },
        { name: 'מוסך הגליל', phone: '052-987-6543' },
        { name: 'מוסך הגליל (סניף 2)', phone: '+972 52 987 6543' },
        { name: 'יוסי שוב', phone: '054 123 4567' },
      ],
      existing,
      '972',
    );
    expect(plan.leads.map((lead) => lead.index)).toEqual([1]);
    expect(plan.skipped).toMatchObject([
      { index: 0, reason: 'exists', leadId: 'lead-1', phone: '0541234567', message: 'המספר כבר שמור בליד ״יוסי שיפוצים״.' },
      { index: 2, reason: 'repeated', firstIndex: 1 },
      // Already in the CRM wins over repeated: that's the more useful reason
      { index: 3, reason: 'exists', leadId: 'lead-1' },
    ]);
  });

  it('says what is wrong with an item, and which fields it did not read', () => {
    const plan = planJsonImport(
      [
        'יוסי',
        null,
        [],
        { phone: '054-1111111' },
        { name: 'בלי טלפון' },
        { name: 'טלפון חסר ספרות', phone: '054-11' },
        { name: { first: 'יוסי' }, phone: '054-2222222' },
        { Name: 'אותיות גדולות', PHONE: '054-3333333', email: 'a@b.example', city: 'חיפה' },
        { שם: 'שדות בעברית', טלפון: '054-4444444', נישה: 'מסגריות', מקור: 'המלצה', הערות: ['שורה אחת', 'שורה שתיים'] },
      ],
      [],
      '972',
    );
    expect(plan.skipped.map(({ index, reason }) => [index, reason])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
      [2, 'invalid'],
      [3, 'invalid'],
      [4, 'no-phone'],
      [5, 'no-phone'],
      [6, 'invalid'],
    ]);
    expect(plan.skipped[3].message).toBe('חסר שם העסק (name).');
    expect(plan.skipped[6].message).toBe('השדה name צריך להכיל טקסט.');
    expect(plan.leads).toEqual([
      { index: 7, name: 'אותיות גדולות', phone: '054-333-3333', campaign: '', note: '' },
      { index: 8, name: 'שדות בעברית', phone: '054-444-4444', campaign: 'מסגריות', note: 'מקור: המלצה\nשורה אחת\nשורה שתיים' },
    ]);
    expect(plan.ignoredFields).toEqual(['email', 'city']);
  });

  it('shortens values longer than a lead allows instead of losing the lead', () => {
    const [lead] = planJsonImport([{ name: 'א'.repeat(200), phone: '054-5555555', niche: 'ב'.repeat(80), notes: 'ג'.repeat(6000) }], [], '972').leads;
    expect(lead.name).toHaveLength(120);
    expect(lead.name.endsWith('…')).toBe(true);
    expect(lead.campaign).toHaveLength(60);
    expect(lead.note).toHaveLength(5000);
  });
});

describe('POST /api/leads/import-json', () => {
  const setup = () => {
    const stores = createMemoryStores();
    const app = createApp({ stores, storage: createLocalStorage(tmpdir()), coach: null }, () => new Date('2026-11-01T08:00:00Z'));
    return { stores, api: request(app) };
  };

  it('saves new leads with one insert, and their source and notes on the timeline', async () => {
    const { api } = setup();
    const response = await api.post('/api/leads/import-json').set('Origin', 'https://omek-leads.vercel.app').send(SAMPLE).expect(201);
    expect(response.body.skipped).toEqual([]);
    expect(response.body.created).toHaveLength(2);
    const [yossi] = response.body.created;
    expect(yossi).toMatchObject({ name: 'יוסי שיפוצים', phone: '054-123-4567', campaign: 'קבלני שיפוצים', stage: 'cold_call', method: 'call', attemptCount: 0 });
    const timeline = (await api.get(`/api/leads/${yossi.id}/timeline`).expect(200)).body;
    expect(timeline.interactions).toMatchObject([{ kind: 'note', body: 'מקור: קמפיין פייסבוק\nביקש לחזור אליו אחרי החגים' }]);
    expect((await api.get('/api/leads').expect(200)).body.map((lead: { name: string }) => lead.name)).toEqual(['יוסי שיפוצים', 'מוסך הגליל']);
  });

  it('saves nothing twice: pasting the same list again skips every number, in whatever format', async () => {
    const { api } = setup();
    const first = (await api.post('/api/leads/import-json').send(SAMPLE).expect(201)).body;
    const again = await api
      .post('/api/leads/import-json')
      .send([
        { ...SAMPLE[0], phone: '+972 54-123-4567' },
        { ...SAMPLE[1], phone: '052 987 6543' },
        { name: 'נגריית הכרמל', phone: '04-8123456', niche: 'נגריות' },
        { name: 'נגריית הכרמל', phone: '048123456' },
      ])
      .expect(201);
    expect(again.body.created.map((lead: { name: string; phone: string }) => [lead.name, lead.phone])).toEqual([['נגריית הכרמל', '04-812-3456']]);
    expect(again.body.skipped).toMatchObject([
      { index: 0, reason: 'exists', leadId: first.created[0].id },
      { index: 1, reason: 'exists', leadId: first.created[1].id },
      { index: 3, reason: 'repeated', firstIndex: 2 },
    ]);
    expect((await api.get('/api/leads').expect(200)).body).toHaveLength(3);
  });

  it('reports items it could not read, and imports the rest', async () => {
    const { api } = setup();
    const response = await api
      .post('/api/leads/import-json')
      .send([{ name: 'בלי טלפון' }, { phone: '054-7777777' }, { name: 'טוב', phone: '054-8888888', email: 'x@y.example' }])
      .expect(201);
    expect(response.body.created).toHaveLength(1);
    expect(response.body.skipped.map((item: { reason: string }) => item.reason)).toEqual(['no-phone', 'invalid']);
    expect(response.body.ignoredFields).toEqual(['email']);
  });

  it('takes only a JSON array of leads, within the limit', async () => {
    const { api } = setup();
    const notArray = await api.post('/api/leads/import-json').send({ name: 'יוסי', phone: '054-1234567' }).expect(400);
    expect(notArray.body.error.message).toBe('צריך לשלוח מערך JSON של לידים: [ { … }, { … } ].');
    expect((await api.post('/api/leads/import-json').send([]).expect(400)).body.error.message).toBe('המערך ריק: אין בו לידים.');
    const tooMany = Array.from({ length: JSON_IMPORT_LIMIT + 1 }, () => ({ name: 'x', phone: '054-1234567' }));
    await api.post('/api/leads/import-json').send(tooMany).expect(400);
    const broken = await api.post('/api/leads/import-json').set('Content-Type', 'application/json').send('[{"name": "יוסי",]').expect(400);
    expect(broken.body.error.message).toBe('גוף הבקשה הוא לא JSON תקין.');
  });

  it('takes a large paste in one request (beyond the 100 kB other requests get)', async () => {
    const { api } = setup();
    const many = Array.from({ length: 800 }, (_, i) => ({
      name: `עסק ${i + 1}`,
      phone: `050-${String(1_000_000 + i)}`,
      niche: 'בדיקה',
      notes: `הערה ארוכה ${randomUUID()} `.repeat(4),
    }));
    expect(JSON.stringify(many).length).toBeGreaterThan(200_000);
    const response = await api.post('/api/leads/import-json').send(many).expect(201);
    expect(response.body.created).toHaveLength(800);
    expect(response.body.skipped).toEqual([]);
  });
});
