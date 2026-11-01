import { describe, expect, it } from 'vitest';
import { createSampleLeads } from '../../data/sampleLeads';
import { EXAMPLE_PASTE } from './example';
import { readPhone, readWebsite } from './fields';
import { parseImport, rowsFromTable, type ParsedRow } from './parse';
import { buildLeads, reviewRows } from './review';

const tsv = (rows: string[][]) => rows.map((row) => row.join('\t')).join('\n');
const pick = ({ name, contactName, phone, email, website, campaign, approach, method, notes }: ParsedRow) => ({
  name,
  contactName,
  phone,
  email,
  website,
  campaign,
  approach,
  method,
  notes,
});

describe('spreadsheet rows', () => {
  it('maps the columns of a weekly batch and reads every field', () => {
    const result = parseImport(EXAMPLE_PASTE);
    expect(result.format).toBe('spreadsheet');
    expect(result.table?.columns.map((column) => column.detected)).toEqual([
      'name', 'contactName', 'phone', 'email', 'website', 'campaign', 'approach',
    ]);
    expect(result.rows).toHaveLength(10);
    expect(pick(result.rows[0])).toEqual({
      name: 'מרכז השיניים עפולה',
      contactName: 'ד"ר רותם שני',
      phone: '050-000-0311',
      email: 'rotem@afula-dental.example',
      website: 'afula-dental.example',
      campaign: 'רופאי שיניים',
      approach: 'לשאול איך מטופלים קובעים תור היום',
      method: null,
      notes: '',
    });
    expect(result.rows[4]).toMatchObject({ phone: '054-000-0119' }); // +972 becomes local
    expect(result.rows[5]).toMatchObject({ phone: '058-000-0355' }); // Excel's lost 0 is restored
  });

  it('maps Hebrew headers and keeps older status and amount columns as labelled notes', () => {
    const result = parseImport(
      tsv([
        ['שם העסק', 'איש קשר', 'טלפון', 'אתר', 'נישה', 'גישה', 'סטטוס', 'סכום'],
        ['מאפיית הגליל', 'אמיר', '054-000-0124', 'www.galil-bakery.example', 'מאפיות', 'הזמנות מראש לשבת', 'לא ענה', '5,500'],
        ['מוסך כהן', 'איציק', '0580000182', '', 'מוסכים', '', '', ''],
      ]),
    );
    expect(result.table?.columns.map((column) => column.detected)).toEqual([
      'name', 'contactName', 'phone', 'website', 'campaign', 'approach', 'notes', 'notes',
    ]);
    expect(pick(result.rows[0])).toMatchObject({
      website: 'www.galil-bakery.example',
      campaign: 'מאפיות',
      approach: 'הזמנות מראש לשבת',
      notes: 'סטטוס: לא ענה\nסכום: 5,500',
    });
    expect(result.rows[1]).toMatchObject({ phone: '058-000-0182', campaign: 'מוסכים' });
  });

  it('recognizes columns by their content when there is no header', () => {
    const result = parseImport(
      tsv([
        ['1', 'Arbel Olive Press', 'Moshe Azulay', '0500000142', 'arbel-olive.co.il', '14000'],
        ['2', 'Galil Dental Studio', 'Avi Peretz', '0540000119', 'galil-dental.co.il', '18000'],
        ['3', 'Tabor Auto Center', 'Ronen Kadosh', '0500000171', '', '7200'],
      ]),
    );
    expect(result.table?.columns.map((column) => column.detected)).toEqual([
      'skip', 'name', 'contactName', 'phone', 'website', 'notes',
    ]);
    expect(result.rows[1]).toMatchObject({ name: 'Galil Dental Studio', phone: '054-000-0119', website: 'galil-dental.co.il' });
  });

  it('turns "Name" into the contact when a business column exists, and skips total rows', () => {
    const result = parseImport(tsv([['Company', 'Name', 'Mobile'], ['Hadar Real Estate', 'Daniel Hadar', '052-000-0158'], ['Total', '', '']]));
    expect(result.table?.columns.map((column) => column.detected)).toEqual(['name', 'contactName', 'phone']);
    expect(result.rows).toHaveLength(1);
  });

  it('keeps quoted cells with line breaks together, and re-maps a column when asked', () => {
    const quoted = parseImport('Business\tNotes\tPhone\n"Nahum Law Office"\t"Second call went well.\nWants Hebrew and English."\t053-000-0138');
    expect(quoted.rows[0].notes).toBe('Second call went well.\nWants Hebrew and English.');

    const table = parseImport(tsv([['Arbel Olive Press', 'Moshe', '050-000-0142']])).table;
    if (!table) throw new Error('expected a table');
    expect(rowsFromTable(table, ['name', 'notes', 'phone'])[0]).toMatchObject({ contactName: '', notes: 'Moshe' });
  });
});

describe('CSV', () => {
  it('reads quoted commas', () => {
    const result = parseImport('Name,Phone,Notes\n"Cohen, Levi & Co",050-000-0101,"Wants a shop, delivery"\nYarden Kayak Tours,053-000-0149,');
    expect(result.format).toBe('csv');
    expect(result.rows.map((row) => row.name)).toEqual(['Cohen, Levi & Co', 'Yarden Kayak Tours']);
  });
});

describe('text lists', () => {
  it('reads one lead per line in mixed formats', () => {
    const result = parseImport(
      [
        '1. Arbel Olive Press - Moshe Azulay - 050-000-0142 - arbel-olive.co.il',
        'Galil Dental 054-0000119 dr.avi@galil.example',
        'מאפיית הגליל | אמיר | 054-000-0124 | רוצים אתר עם הזמנות',
        'Golan Steakhouse (Yaniv Malka) +972 50-000-0105 https://golan-steak.example/menu',
        'Moshe Levi - Levi Accounting - 0520000999',
        'Contact: Shlomo Biton, Business: Yarden Kayak Tours, Phone: 053-000-0149, Niche: Tourism',
        'Tabor Auto Center, 050-000-0171, no answer, whatsapp',
      ].join('\n'),
    );
    expect(result.format).toBe('lines');
    expect(result.rows.map((row) => [row.name, row.contactName, row.phone, row.email, row.website, row.campaign, row.method, row.notes])).toEqual([
      ['Arbel Olive Press', 'Moshe Azulay', '050-000-0142', '', 'arbel-olive.co.il', '', null, ''],
      ['Galil Dental', '', '054-000-0119', 'dr.avi@galil.example', '', '', null, ''],
      ['מאפיית הגליל', 'אמיר', '054-000-0124', '', '', '', null, 'רוצים אתר עם הזמנות'],
      ['Golan Steakhouse', 'Yaniv Malka', '050-000-0105', '', 'https://golan-steak.example/menu', '', null, ''],
      ['Levi Accounting', 'Moshe Levi', '052-000-0999', '', '', '', null, ''],
      ['Yarden Kayak Tours', 'Shlomo Biton', '053-000-0149', '', '', 'Tourism', null, ''],
      ['Tabor Auto Center', '', '050-000-0171', '', '', '', 'whatsapp', 'no answer'],
    ]);
  });

  it('reads one lead per paragraph, and keeps one per line when blank lines only group them', () => {
    const blocks = parseImport('Arbel Olive Press\nMoshe Azulay\n050-000-0142\n\nKinneret Sail Charters\n052-000-0187\neli@kinneret.example');
    expect(blocks.format).toBe('blocks');
    expect(blocks.rows.map((row) => [row.name, row.contactName, row.phone, row.email])).toEqual([
      ['Arbel Olive Press', 'Moshe Azulay', '050-000-0142', ''],
      ['Kinneret Sail Charters', '', '052-000-0187', 'eli@kinneret.example'],
    ]);
    const grouped = parseImport('Arbel - 050-000-0142\nGalil - 054-000-0119\n\nKinneret - 052-000-0187\nTabor - 050-000-0171');
    expect(grouped.format).toBe('lines');
    expect(grouped.rows).toHaveLength(4);
  });

  it('handles a weekly batch of 60', () => {
    const people = ['Dana Levi', 'Avi Cohen', 'Noa Peretz', 'Yossi Mizrahi', 'Tali Ben-David'];
    const lines = Array.from({ length: 60 }, (_, i) => `Lead ${i + 1} - ${people[i % 5]} - 050-000-${String(1000 + i).slice(-4)}`);
    const result = parseImport(lines.join('\n'));
    expect(result.rows).toHaveLength(60);
    expect(result.rows[59]).toMatchObject({ name: 'Lead 60', contactName: 'Tali Ben-David', phone: '050-000-1059' });
  });
});

describe('field readers', () => {
  it('reads phone numbers and ignores dates and order numbers', () => {
    expect(readPhone('(050) 000-0142')).toBe('050-000-0142');
    expect(readPhone('00972-52-000-0187')).toBe('052-000-0187');
    expect(readPhone('+1 (415) 555-0100')).toBe('+1 (415) 555-0100');
    expect(readPhone('21.10.2026')).toBeNull();
    expect(readPhone('123456789')).toBeNull();
    expect(readPhone('521234567', true)).toBe('052-123-4567');
  });

  it('reads websites and refuses other link schemes', () => {
    expect(readWebsite('arbel-olive.co.il')).toBe('arbel-olive.co.il');
    expect(readWebsite('https://www.example.com/contact')).toBe('https://www.example.com/contact');
    expect(readWebsite('javascript:alert(1)')).toBeNull();
    expect(readWebsite('moshe@arbel.co.il')).toBeNull();
  });
});

describe('review and build', () => {
  const existing = createSampleLeads(Date.parse('2026-10-21T12:00:00Z'));

  it('flags leads already in the CRM, repeats and missing names', () => {
    const rows = reviewRows(parseImport(EXAMPLE_PASTE).rows, existing);
    expect(rows.filter((row) => row.issue === 'in-crm').map((row) => row.match)).toEqual(['סטודיו השיניים של הגליל']);
    expect(rows.filter((row) => row.issue === 'repeated').map((row) => row.name)).toEqual(['מרכז השיניים עפולה']);
    const unnamed = reviewRows(parseImport('052-000-0999\nTamar Pottery - 050-000-0998').rows, []);
    expect(unnamed.map((row) => row.issue)).toEqual(['missing-name', null]);
  });

  it('builds Cold Call leads in paste order, tagged with the batch campaign', () => {
    const rows = parseImport('Tamar Pottery - 050-000-0998\nRotem Flowers - 050-000-0997').rows;
    const leads = buildLeads(rows, { campaign: 'Gift shops', method: 'whatsapp', currency: 'ILS' }, Date.parse('2026-10-21T12:00:00Z'));
    expect(leads.map((lead) => lead.createdAt)).toEqual(['2026-10-21T12:00:00.000Z', '2026-10-21T11:59:59.999Z']);
    expect(leads[0]).toMatchObject({
      stage: 'cold_call',
      campaign: 'Gift shops',
      method: 'whatsapp',
      deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
      attemptCount: 0,
      archivedAt: null,
      activity: [],
    });
  });
});
