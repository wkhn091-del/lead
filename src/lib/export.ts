import { strToU8, zipSync } from 'fflate';
import type { Lead } from '../types';
import { EXPORT_COLUMNS, type ExportColumn, type ExportValue } from './leads-table';

/**
 * The leads shown, as a spreadsheet: a real Excel file (.xlsx), right to left, with a frozen header row, filters on
 * every column, dates as dates and amounts as numbers; or a CSV for anything else. Written in the browser, so it
 * works offline too.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text as XML allows it: escaped, without the control characters XML has no place for */
const xml = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A, B, …, Z, AA… */
const columnName = (index: number): string => (index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + columnName(index % 26));

/** Excel's day number for a moment, in this browser's time zone (what the app shows) */
const excelDate = (date: Date) =>
  (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()) - Date.UTC(1899, 11, 30)) /
  86_400_000;

// Styles, by their place in cellXfs below
const STYLE: Record<ExportColumn['kind'] | 'header', number> = { text: 0, header: 1, date: 2, datetime: 3, money: 4, number: 0 };

const STYLES = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="#,##0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB8C2D0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cell(ref: string, value: ExportValue, kind: ExportColumn['kind'] | 'header'): string {
  if (value === null || value === '') return '';
  const style = STYLE[kind] ? ` s="${STYLE[kind]}"` : '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : `<c r="${ref}"${style}><v>${excelDate(value)}</v></c>`;
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheet(leads: readonly Lead[], columns: readonly ExportColumn[]): string {
  const last = columnName(columns.length - 1);
  const header = `<row r="1" ht="22" customHeight="1">${columns.map((column, index) => cell(`${columnName(index)}1`, column.header, 'header')).join('')}</row>`;
  const rows = leads.map(
    (lead, row) =>
      `<row r="${row + 2}">${columns.map((column, index) => cell(`${columnName(index)}${row + 2}`, column.value(lead), column.kind)).join('')}</row>`,
  );
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}${leads.length + 1}"/>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${header}${rows.join('')}</sheetData>
<autoFilter ref="A1:${last}${Math.max(leads.length + 1, 2)}"/>
</worksheet>`;
}

/** An .xlsx workbook with one sheet, "לידים" */
export function leadsWorkbook(leads: readonly Lead[], columns: readonly ExportColumn[] = EXPORT_COLUMNS): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="לידים" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'לידים'!$A$1:$${columnName(columns.length - 1)}$${Math.max(leads.length + 1, 2)}</definedName></definedNames>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheet(leads, columns)),
  };
  return zipSync(files, { level: 6 });
}

const two = (n: number) => String(n).padStart(2, '0');
const csvDate = (date: Date, withTime: boolean) =>
  `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}${withTime ? ` ${two(date.getHours())}:${two(date.getMinutes())}` : ''}`;

/** The same rows as CSV, with a byte order mark so Excel reads the Hebrew right */
export function leadsCsv(leads: readonly Lead[], columns: readonly ExportColumn[] = EXPORT_COLUMNS): string {
  const field = (value: ExportValue, kind: ExportColumn['kind']) => {
    const text = value === null ? '' : value instanceof Date ? csvDate(value, kind === 'datetime') : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((column) => field(column.header, 'text')), ...leads.map((lead) => columns.map((column) => field(column.value(lead), column.kind)))];
  return `﻿${lines.map((line) => line.join(',')).join('\r\n')}\r\n`;
}

/** "לידים-04-11-2026" */
export const exportName = (now = new Date()) => `לידים-${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}`;

/** Saves a file to the device, the way a download does */
export function download(data: Uint8Array | string, fileName: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportLeads(leads: readonly Lead[], format: 'xlsx' | 'csv') {
  if (format === 'xlsx') download(leadsWorkbook(leads), `${exportName()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  else download(leadsCsv(leads), `${exportName()}.csv`, 'text/csv;charset=utf-8');
}
