import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createSampleLeads } from '../data/sampleLeads';
import { exportName, leadsCsv, leadsWorkbook } from './export';
import { EXPORT_COLUMNS } from './leads-table';

const leads = createSampleLeads(Date.parse('2026-11-04T10:00:00'));

describe('exporting the leads', () => {
  it('writes an Excel workbook: right to left, a frozen header, filters, and every lead in the order given', () => {
    const tricky = { ...leads[0], name: 'R&D <שיפוצים> "בע״מ"\u0007', phone: '054-123-4567' };
    const files = unzipSync(leadsWorkbook([tricky, ...leads.slice(1)]));
    expect(Object.keys(files).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<sheetView rightToLeft="1"');
    expect(sheet).toContain('state="frozen"');
    // A filter on every column, the last one (R) being the Google Maps link
    expect(sheet).toContain(`<autoFilter ref="A1:R${leads.length + 1}"/>`);
    expect(sheet).toContain('R&amp;D &lt;שיפוצים&gt; &quot;בע״מ&quot;</t>');
    // A phone number stays text, so its leading 0 does too
    expect(sheet).toContain('<t xml:space="preserve">054-123-4567</t>');
    expect((sheet.match(/<row /g) ?? []).length).toBe(leads.length + 1);
    expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="לידים"');
  });

  it('writes the same rows as CSV that Excel reads in Hebrew', () => {
    const csv = leadsCsv([{ ...leads[0], name: 'מוסך "הגליל", חיפה', createdAt: '2026-11-04T08:30:00.000Z' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, row] = csv.slice(1).trimEnd().split('\r\n');
    expect(header.split(',')).toEqual(EXPORT_COLUMNS.map((column) => column.header));
    expect(row.startsWith('"מוסך ""הגליל"", חיפה",')).toBe(true);
  });

  it('names the file by the day', () => {
    expect(exportName(new Date('2026-11-04T10:00:00'))).toBe('לידים-04-11-2026');
  });
});
