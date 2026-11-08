import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { displayPhone, JSON_IMPORT_LIMIT, jsonField, jsonFieldsOf, jsonKeysOf, leadList, phoneKey, planJsonImport, withDetailsInNote } from '../src/leads/json-import.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createMemoryStores } from './memory-stores.js';

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

  it('turns name, phone, niche, source and notes into a lead, its first note saying it came from JSON', () => {
    const plan = planJsonImport(SAMPLE, [], '972');
    expect(plan.skipped).toEqual([]);
    expect(plan.ignoredFields).toEqual([]);
    const blank = { contactName: '', email: '', website: '', city: '', mapsUrl: '' };
    expect(plan.leads).toEqual([
      { index: 0, name: 'יוסי שיפוצים', phone: '054-123-4567', campaign: 'קבלני שיפוצים', note: 'יובא מקובץ JSON\nמקור: קמפיין פייסבוק\nביקש לחזור אליו אחרי החגים', ...blank },
      { index: 1, name: 'מוסך הגליל', phone: '052-987-6543', campaign: 'מוסכים', note: 'יובא מקובץ JSON\nמקור: חיפוש גוגל', ...blank },
    ]);
  });

  it('finds each field by its usual names, in any case and with any separator', () => {
    for (const [key, field] of [
      ['title', 'name'],
      ['Business Name', 'name'],
      ['company_name', 'name'],
      ['LABEL', 'name'],
      ['phone_number', 'phone'],
      ['Telephone', 'phone'],
      ['mobile', 'phone'],
      ['tel', 'phone'],
      ['טלפון נייד', 'phone'],
      ['categoryName', 'niche'],
      ['cat', 'niche'],
      ['type', 'niche'],
      ['קטגוריה', 'niche'],
      ['address', 'address'],
      ['location', 'address'],
      ['description', 'description'],
      ['דוא"ל', 'email'],
      ['web-site', 'website'],
    ] as const) {
      expect(jsonField(key), key).toBe(field);
    }
    expect(jsonField('countryCode')).toBeNull();
  });

  it('reads a Google Maps or Yellow Pages scrape: title, categories, street and city, rating and the listing', () => {
    const plan = planJsonImport(
      [
        {
          title: 'המספרה אליהו',
          totalScore: 4.8,
          reviewsCount: 157,
          street: 'בית וגן 42',
          city: 'ירושלים',
          state: null,
          countryCode: 'IL',
          phone: '+972 50-909-4047',
          categories: ['מספרה'],
          url: 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ_WdbXrzXAhURVLgwOQFqrDY',
        },
        { businessName: 'פרחי השרון', Phone: ['', '09-7654321', '050 123 4567'], category: { id: 7, name: 'חנויות פרחים' }, address: { street: 'הרצל', number: 5, city: 'רעננה' }, url: 'https://www.d.co.il/80123456/' },
      ],
      [],
      '972',
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.leads).toEqual([
      {
        index: 0,
        name: 'המספרה אליהו',
        contactName: '',
        phone: '050-909-4047',
        email: '',
        website: '',
        // The city and the Maps listing go on the lead; the note keeps them with the rest
        city: 'ירושלים',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ_WdbXrzXAhURVLgwOQFqrDY',
        campaign: 'מספרה',
        note: [
          'יובא מקובץ JSON',
          'כתובת: בית וגן 42, ירושלים',
          'דירוג: 4.8 (157 ביקורות)',
          'גוגל מפות: https://www.google.com/maps/search/?api=1&query_place_id=ChIJ_WdbXrzXAhURVLgwOQFqrDY',
        ].join('\n'),
      },
      {
        index: 1,
        name: 'פרחי השרון',
        contactName: '',
        phone: '09-765-4321',
        email: '',
        website: '',
        // From inside the address; a Yellow Pages link isn't a Maps listing
        city: 'רעננה',
        mapsUrl: '',
        campaign: 'חנויות פרחים',
        note: 'יובא מקובץ JSON\nכתובת: הרצל 5, רעננה\nטלפון נוסף: 050-123-4567\nדפי זהב: https://www.d.co.il/80123456/',
      },
    ]);
    // A null field is nothing to read; a field with a value no one reads is named
    expect(plan.ignoredFields).toEqual(['countryCode']);
  });

  it('keeps the contact person, email and website on the lead, and what is not valid in the note', () => {
    const [company, nested, junk] = planJsonImport(
      [
        { company: 'מוסך אבי', name: 'אבי כהן', phone: '052-9998877', email: 'mailto:avi@garage.example', website: 'garage.example' },
        { company: { name: 'נגריית הכרמל', phone: '04-8123456' }, contact: { name: 'דני', email: 'dani@carmel.example' }, location: { lat: 32.8, lng: 35 } },
        { name: 'סטודיו', phone: '054-6667788', email: 'לא מייל', website: 'אין אתר', notes: [{ body: 'להתקשר בבוקר' }, 'שורה שנייה'] },
      ],
      [],
      '972',
    ).leads;
    expect(company).toMatchObject({ name: 'מוסך אבי', contactName: 'אבי כהן', email: 'avi@garage.example', website: 'garage.example', note: 'יובא מקובץ JSON' });
    expect(nested).toMatchObject({ name: 'נגריית הכרמל', contactName: 'דני', phone: '04-812-3456', email: 'dani@carmel.example' });
    expect(junk).toMatchObject({ email: '', website: '', note: 'יובא מקובץ JSON\nאימייל: לא מייל\nאתר: אין אתר\nלהתקשר בבוקר\nשורה שנייה' });
    expect(withDetailsInNote(company)).toMatchObject({
      contactName: '',
      email: '',
      website: '',
      note: 'יובא מקובץ JSON\nאיש קשר: אבי כהן\nאימייל: avi@garage.example\nאתר: garage.example',
    });
  });

  it('finds the list an export wraps its leads in', () => {
    const leads = [{ title: 'א', phone: '054-1234567' }];
    expect(leadList(leads)).toEqual(leads);
    expect(leadList({ meta: { total: 1 }, data: leads })).toEqual(leads);
    expect(leadList({ response: { results: leads } })).toEqual(leads);
    expect(leadList({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: leads[0], geometry: null }] })).toEqual(leads);
    // A single lead isn't a list, even with a list inside it
    expect(leadList({ name: 'א', phone: '054-1234567', reviews: [{ text: 'מצוין' }] })).toBeNull();
    expect(leadList('א')).toBeNull();
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
        { Name: 'אותיות גדולות', PHONE: '054-3333333', email: 'a@b.example', city: 'חיפה', fax: '04-1234567' },
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
    expect(plan.skipped[3].message).toBe('חסר שם העסק (name, title או company).');
    expect(plan.skipped[4].message).toBe('אין מספר טלפון (phone, mobile או tel).');
    expect(plan.skipped[6].message).toBe('השדה name צריך להכיל טקסט.');
    expect(plan.leads).toEqual([
      { index: 7, name: 'אותיות גדולות', contactName: '', phone: '054-333-3333', email: 'a@b.example', website: '', city: 'חיפה', mapsUrl: '', campaign: '', note: 'יובא מקובץ JSON\nכתובת: חיפה' },
      {
        index: 8,
        name: 'שדות בעברית',
        contactName: '',
        phone: '054-444-4444',
        email: '',
        website: '',
        city: '',
        mapsUrl: '',
        campaign: 'מסגריות',
        note: 'יובא מקובץ JSON\nמקור: המלצה\nשורה אחת\nשורה שתיים',
      },
    ]);
    expect(plan.ignoredFields).toEqual(['name', 'fax']);
  });

  it('fills in the city, Maps link and website a lead already here is missing, and changes nothing it has', () => {
    const maps = 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJabc';
    const existing = [
      { id: 'old', name: 'מספרת קובי', phone: '050-111-2233', city: '', mapsUrl: '', website: '' },
      { id: 'full', name: 'נגריית הכרמל', phone: '04-812-3456', city: 'חיפה', mapsUrl: maps, website: 'carmel.example' },
      // An app that doesn't say what a lead has: nothing is filled in on a guess
      { id: 'unknown', name: 'מסגרייה', phone: '054-999-8877' },
    ];
    const plan = planJsonImport(
      [
        { title: 'מספרת קובי', phone: '+972 50-111-2233', city: 'ירושלים', url: maps, website: 'kobi.example' },
        { title: 'מספרת קובי שוב', phone: '0501112233', city: 'תל אביב' },
        { title: 'נגריית הכרמל', phone: '04-8123456', city: 'עכו', url: 'https://www.google.com/maps/place/other' },
        { title: 'מסגרייה', phone: '054-9998877', city: 'באר שבע' },
      ],
      existing,
      '972',
    );
    expect(plan.leads).toEqual([]);
    expect(plan.fills).toEqual([{ index: 0, id: 'old', name: 'מספרת קובי', details: { city: 'ירושלים', mapsUrl: maps, website: 'kobi.example' } }]);
    expect(plan.skipped.map(({ index, reason, leadId }) => [index, reason, leadId])).toEqual([
      [1, 'exists', 'old'],
      [2, 'exists', 'full'],
      [3, 'exists', 'unknown'],
    ]);
    // The list given isn't changed
    expect(existing[0].city).toBe('');
  });

  it('reads keys by what is in them, after every exact name', () => {
    for (const [key, field] of [
      ['business_phone', 'phone'],
      ['Phone 2', 'phone'],
      ['phoneUnformatted', 'phone'],
      ['contactPhone', 'phone'],
      ['tel1', 'phone'],
      ['טלפון נוסף', 'phone'],
      ['whatsappNumber', 'phone'],
      ['contactEmail', 'email'],
      ['mainCategory', 'niche'],
      ['businessType', 'niche'],
      ['סוג העסק', 'niche'],
      ['name_he', 'name'],
      ['storeName', 'name'],
      ['שם העסק באנגלית', 'name'],
      ['cityName', 'city'],
      ['ownerFullName', 'contactName'],
      ['בעל העסק', 'contactName'],
      ['facebookUrl', 'link'],
    ] as const) {
      expect(jsonField(key), key).toBe(field);
    }
    // Only look the part: a fax, an image, a job title, a place's id, a capacity
    for (const key of ['fax', 'imageUrl', 'jobTitle', 'placeId', 'capacity', 'phoneVerified', 'imageCategories', 'countryCode', 'scrapedAt']) {
      expect(jsonField(key), key).toBeNull();
    }

    const [lead] = planJsonImport(
      [{ business_title: 'קפה נחת', mainPhone: '02-6250000', 'Phone 2': '054-1112233', businessType: 'בתי קפה', placeId: 7731, imageUrl: 'https://x.example/a.jpg' }],
      [],
      '972',
    ).leads;
    expect(lead).toMatchObject({ name: 'קפה נחת', phone: '02-625-0000', campaign: 'בתי קפה', note: 'יובא מקובץ JSON\nטלפון נוסף: 054-111-2233' });
    // An exact name still comes first, and a number isn't a name
    expect(planJsonImport([{ storeName: 'חנות', name: 'מספרת אליהו', phone: '054-2223344' }], [], '972').leads[0].name).toBe('מספרת אליהו');
    expect(planJsonImport([{ listingName: 48213, title: 'נגריית הכרמל', phone: '054-3334455' }], [], '972').leads[0].name).toBe('נגריית הכרמל');
    expect(jsonFieldsOf([{ title: 'א', phone: '054-1234567', placeId: 'ChIJ…', imageUrl: 'https://x.example/a.jpg' }]).unread).toEqual(['placeId', 'imageUrl']);
  });

  it('finds a phone by how its value is written when no key names one', () => {
    const plan = planJsonImport(
      [
        { 'שם העסק': 'מסגרייה', 'מס׳': '054-9998877', field3: '+972 52-111-2233', fax: '03-5556677' },
        { title: 'בלי מספר', code: '1234', fax: '03-5556677', date: '2026-11-04' },
      ],
      [],
      '972',
    );
    expect(plan.leads).toEqual([
      { index: 0, name: 'מסגרייה', contactName: '', phone: '054-999-8877', email: '', website: '', city: '', mapsUrl: '', campaign: '', note: 'יובא מקובץ JSON\nטלפון נוסף: 052-111-2233' },
    ]);
    expect(plan.skipped).toMatchObject([{ index: 1, reason: 'no-phone' }]);
    expect(plan.ignoredFields).toEqual(['fax', 'code', 'date']);
  });

  it('reads the name, phone and niche from keys chosen by hand, and the rest as before', () => {
    const items = [
      { name: 'יוסי כהן', label: 'שיפוצי יוסי', primary: '03-1112233', other: '054-1234567', kind: 'שיפוצים', category: 'כללי' },
      { name: 'דנה לוי', label: '', contact: { cell: '052-7654321' }, kind: 'עיצוב', category: 'כללי' },
    ];
    const plan = planJsonImport(items, [], '972', { name: 'label', phone: 'other', niche: 'kind' });
    expect(plan.leads.map(({ name, phone, campaign, note }) => ({ name, phone, campaign, note }))).toEqual([
      { name: 'שיפוצי יוסי', phone: '054-123-4567', campaign: 'שיפוצים', note: 'יובא מקובץ JSON' },
      // The chosen key is empty here: the name comes from where it would anyway
      { name: 'דנה לוי', phone: '052-765-4321', campaign: 'עיצוב', note: 'יובא מקובץ JSON' },
    ]);
    // A key with a phone in it that no name points to is named, not guessed at, once a phone was chosen
    expect(plan.ignoredFields).toEqual(['primary']);
    // One level down, too
    expect(planJsonImport(items.slice(1), [], '972', { phone: 'contact.cell' }).leads[0].phone).toBe('052-765-4321');
    expect(jsonFieldsOf(items, { name: 'label' }).fields.name?.[0]).toBe('label');
    expect(jsonKeysOf(items).slice(0, 4)).toEqual([
      { key: 'name', count: 2, example: 'יוסי כהן' },
      { key: 'kind', count: 2, example: 'שיפוצים' },
      { key: 'category', count: 2, example: 'כללי' },
      { key: 'label', count: 1, example: 'שיפוצי יוסי' },
    ]);
    expect(jsonKeysOf(items).map(({ key }) => key)).toContain('contact.cell');
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

  it('saves new leads with one insert, each with a first note on the timeline', async () => {
    const { api } = setup();
    const response = await api.post('/api/leads/import-json').set('Origin', 'https://omek-leads.vercel.app').send(SAMPLE).expect(201);
    expect(response.body.skipped).toEqual([]);
    expect(response.body.created).toHaveLength(2);
    const [yossi] = response.body.created;
    expect(yossi).toMatchObject({ name: 'יוסי שיפוצים', phone: '054-123-4567', campaign: 'קבלני שיפוצים', stage: 'cold_call', method: 'call', attemptCount: 0 });
    const timeline = (await api.get(`/api/leads/${yossi.id}/timeline`).expect(200)).body;
    expect(timeline.interactions).toMatchObject([{ kind: 'note', body: 'יובא מקובץ JSON\nמקור: קמפיין פייסבוק\nביקש לחזור אליו אחרי החגים' }]);
    const garage = response.body.created[1];
    expect((await api.get(`/api/leads/${garage.id}/timeline`).expect(200)).body.interactions).toMatchObject([{ kind: 'note', body: 'יובא מקובץ JSON\nמקור: חיפוש גוגל' }]);
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
      .send([{ name: 'בלי טלפון' }, { phone: '054-7777777' }, { name: 'טוב', phone: '054-8888888', email: 'x@y.example', fax: '03-1234567' }])
      .expect(201);
    expect(response.body.created).toHaveLength(1);
    expect(response.body.created[0]).toMatchObject({ name: 'טוב', email: 'x@y.example' });
    expect(response.body.skipped.map((item: { reason: string }) => item.reason)).toEqual(['no-phone', 'invalid']);
    expect(response.body.ignoredFields).toEqual(['fax']);
  });

  it('takes a scrape as it was exported, and the list it is wrapped in', async () => {
    const { api } = setup();
    const response = await api
      .post('/api/leads/import-json')
      .send({
        data: [
          { title: 'מספרת קובי', phone: '+972 50-111-2233', categoryName: 'מספרה', street: 'בית וגן 69', city: 'ירושלים', website: 'https://instagram.com/kobi' },
          { Business_Name: 'נגריית הכרמל', Mobile: '054 444 5566', Type: 'נגריות', Contact: 'דני', Email: 'not-an-email' },
        ],
      })
      .expect(201);
    expect(response.body.skipped).toEqual([]);
    expect(response.body.created).toMatchObject([
      { name: 'מספרת קובי', phone: '050-111-2233', campaign: 'מספרה', website: 'https://instagram.com/kobi', stage: 'cold_call', attemptCount: 0 },
      { name: 'נגריית הכרמל', phone: '054-444-5566', campaign: 'נגריות', contactName: 'דני', email: '' },
    ]);
    const timeline = (await api.get(`/api/leads/${response.body.created[1].id}/timeline`).expect(200)).body;
    expect(timeline.interactions).toMatchObject([{ kind: 'note', body: 'יובא מקובץ JSON\nאימייל: not-an-email' }]);
  });

  it('takes the keys chosen by hand in the address, and saves every lead as new', async () => {
    const { api } = setup();
    const response = await api
      .post('/api/leads/import-json?name=label&phone=other&niche=kind&ignored=1')
      .send([{ name: 'יוסי כהן', label: 'שיפוצי יוסי', other: '054-1234567', kind: 'שיפוצים' }])
      .expect(201);
    expect(response.body.created).toMatchObject([{ name: 'שיפוצי יוסי', contactName: '', phone: '054-123-4567', campaign: 'שיפוצים', stage: 'cold_call', activity: [] }]);
    await api.post(`/api/leads/import-json?name=${'x'.repeat(201)}`).send([{ name: 'א', phone: '054-7654321' }]).expect(400);
  });

  it('completes the leads an earlier import made, when the list is imported again', async () => {
    const { api } = setup();
    const maps = 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJxyz';
    await api.post('/api/leads/import-json').send([{ name: 'מספרת קובי', phone: '050-1112233' }]).expect(201);
    const again = await api
      .post('/api/leads/import-json')
      .send([{ title: 'מספרת קובי', phone: '+972 50-111-2233', city: 'ירושלים', url: maps }, { title: 'חדשה', phone: '052-7654321', city: 'טבריה' }])
      .expect(201);
    expect(again.body.created).toMatchObject([{ name: 'חדשה', city: 'טבריה', mapsUrl: '' }]);
    expect(again.body.updated).toMatchObject([{ name: 'מספרת קובי', city: 'ירושלים', mapsUrl: maps, stage: 'cold_call' }]);
    expect(again.body.skipped).toEqual([]);
    const leads = (await api.get('/api/leads').expect(200)).body as { name: string; city: string }[];
    expect(leads.map(({ name, city }) => [name, city]).sort()).toEqual([
      ['חדשה', 'טבריה'],
      ['מספרת קובי', 'ירושלים'],
    ]);
    // And a city or Maps link can be set by hand, a link only if it's http(s)
    const [kobi] = again.body.updated as { id: string }[];
    await api.patch(`/api/leads/${kobi.id}`).send({ city: 'בית שמש' }).expect(200);
    await api.patch(`/api/leads/${kobi.id}`).send({ mapsUrl: 'javascript:alert(1)' }).expect(400);
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
