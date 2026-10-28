import type { ContactMethod } from '../../types';
import {
  findEmail,
  headerField,
  isBusinessLike,
  isNotesHeader,
  isPersonName,
  matchChannel,
  normalizeWord,
  readPhone,
  readWebsite,
  findPhones,
  takeContacts,
  type ColumnTarget,
  type HeaderMatch,
} from './fields';
import { splitDelimited } from './table';

export type ImportFormat = 'spreadsheet' | 'csv' | 'lines' | 'blocks';

/** One lead read from the paste, before defaults are applied */
export interface ParsedRow {
  /** Stays the same while the paste does, so selections survive re-mapping columns */
  key: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  campaign: string;
  approach: string;
  method: ContactMethod | null;
  notes: string;
}

export interface ImportColumn {
  /** Header text, or null when the paste has no header row */
  header: string | null;
  /** The first few values, to recognize the column by */
  samples: string[];
  /** The field this column was matched to */
  detected: ColumnTarget;
}

export interface ImportTable {
  /** Data rows, without the header */
  rows: string[][];
  columns: ImportColumn[];
}

export interface ParseResult {
  /** Null when nothing was pasted */
  format: ImportFormat | null;
  /** Columns that can be re-mapped, for spreadsheet and CSV pastes */
  table: ImportTable | null;
  rows: ParsedRow[];
}

/**
 * Reads pasted leads: rows copied from Excel or Google Sheets (tab-separated), CSV,
 * one lead per line ("Arbel Olive Press - Moshe - 050-000-0142"), or one lead per paragraph.
 */
export function parseImport(input: string): ParseResult {
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, '');
  if (!text.trim()) return { format: null, table: null, rows: [] };

  const table = readTable(text);
  if (table) {
    const targets = table.table.columns.map((column) => column.detected);
    return { format: table.format, table: table.table, rows: rowsFromTable(table.table, targets) };
  }

  const blocks = readBlocks(text);
  if (blocks) {
    return { format: 'blocks', table: null, rows: keepLeads(blocks.map((lines, i) => readRecord(lines, `b${i}`))) };
  }

  const lines = text.split('\n').filter((line) => line.trim());
  return { format: 'lines', table: null, rows: keepLeads(lines.map((line, i) => readRecord([line], `l${i}`))) };
}

/** Rows of a spreadsheet or CSV paste, with each column read as the given field. */
export function rowsFromTable(table: ImportTable, targets: readonly ColumnTarget[]): ParsedRow[] {
  return keepLeads(table.rows.map((cells, i) => readCells(cells, targets, table.columns, `r${i}`)));
}

function emptyRow(key: string): ParsedRow {
  return {
    key,
    name: '',
    contactName: '',
    phone: '',
    email: '',
    website: '',
    campaign: '',
    approach: '',
    method: null,
    notes: '',
  };
}

const TOTAL_WORDS = new Set(['total', 'totals', 'grand total', 'sum', 'סה"כ', 'סהכ', 'סך הכל', 'סך הכול', 'סיכום']);

/** Drops rows with nothing to identify a lead by, and spreadsheet total rows. */
function keepLeads(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => {
    if (!row.name && !row.phone && !row.email) return false;
    return row.phone || row.email || !TOTAL_WORDS.has(normalizeWord(row.name));
  });
}

// ─── Spreadsheets and CSV ────────────────────────────────────────────────────

function readTable(text: string): { format: 'spreadsheet' | 'csv'; table: ImportTable } | null {
  const lines = text.split('\n').filter((line) => line.trim());
  const tabbed = lines.filter((line) => line.includes('\t')).length;
  if (tabbed > 0 && tabbed >= lines.length / 2) {
    return { format: 'spreadsheet', table: buildTable(splitDelimited(text, '\t')).table };
  }

  for (const delimiter of [',', ';']) {
    const grid = splitDelimited(text, delimiter).filter((row) => row.some((cell) => cell.trim()));
    const width = mostCommon(grid.map((row) => row.length));
    if (width < 2 || grid.filter((row) => row.length === width).length < grid.length * 0.8) continue;
    const { table, hasHeader, typed } = buildTable(grid);
    // Plain lists have commas too. Treat it as CSV only with a header row or clean phone or email columns.
    if (hasHeader || typed) return { format: 'csv', table };
  }
  return null;
}

interface Profile {
  count: number;
  phone: number;
  email: number;
  website: number;
  /** Numbers and amounts, kept as notes */
  numeric: number;
  method: number;
  words: number;
  length: number;
}

interface ColumnDraft {
  header: string | null;
  values: string[];
  headerMatch: HeaderMatch | null;
  profile: Profile;
  target: ColumnTarget | 'text';
  loose: boolean;
}

function buildTable(grid: string[][]) {
  const rows = grid.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  const width = Math.max(0, ...rows.map((row) => row.length));
  const first = rows[0] ?? [];
  const hasHeader = rows.length > 1 && isHeaderRow(first, rows.slice(1), width);
  const data = hasHeader ? rows.slice(1) : rows;

  const drafts: ColumnDraft[] = Array.from({ length: width }, (_, index) => {
    const values = data.map((row) => row[index] ?? '').filter(Boolean);
    const header = hasHeader ? first[index] || null : null;
    return {
      header,
      values,
      headerMatch: header ? headerField(header) : null,
      profile: profile(values),
      target: 'text',
      loose: false,
    };
  });
  assignTargets(drafts);

  const columns: ImportColumn[] = drafts.map((draft) => ({
    header: draft.header,
    samples: draft.values.slice(0, 3),
    detected: draft.target === 'text' ? 'notes' : draft.target,
  }));
  const typed = drafts.some(
    (draft) => (draft.target === 'phone' && draft.profile.phone >= 0.6) || (draft.target === 'email' && draft.profile.email >= 0.6),
  );
  return { table: { rows: data, columns }, hasHeader, typed };
}

const NUMERIC = /^[\d\s.,₪$%kK~+-]*\d[\d\s.,₪$%kK~+-]*$/;

const looksLikeData = (cell: string) =>
  readPhone(cell, true) !== null || findEmail(cell) !== null || readWebsite(cell) !== null || NUMERIC.test(cell);

function isHeaderRow(first: string[], rest: string[][], width: number): boolean {
  const cells = first.filter(Boolean);
  // A header never holds phone numbers, emails or amounts.
  if (cells.length === 0 || cells.some(looksLikeData)) return false;
  if (cells.some((cell) => headerField(cell))) return true;
  // Unknown labels ("City", "Firma") still count when the rows below hold phones or emails under them.
  return Array.from({ length: width }, (_, i) => i).some((i) => {
    const label = first[i];
    if (!label || label.length > 30 || /\d/.test(label)) return false;
    const values = rest.map((row) => row[i] ?? '').filter(Boolean);
    const stats = profile(values);
    return stats.count > 0 && (stats.phone >= 0.6 || stats.email >= 0.6);
  });
}

function profile(values: string[]): Profile {
  const sample = values.slice(0, 200);
  const count = sample.length;
  if (count === 0) return { count, phone: 0, email: 0, website: 0, numeric: 0, method: 0, words: 0, length: 0 };
  const share = (test: (value: string) => boolean) => sample.filter(test).length / count;
  const average = (measure: (value: string) => number) => sample.reduce((sum, value) => sum + measure(value), 0) / count;
  return {
    count,
    phone: share((value) => readPhone(value, true) !== null),
    email: share((value) => findEmail(value) !== null && value.split(/\s+/).length <= 3),
    website: share((value) => readWebsite(value) !== null),
    numeric: share((value) => NUMERIC.test(value) && readPhone(value, true) === null),
    method: share((value) => matchChannel(value, false) !== null),
    words: average((value) => value.split(/\s+/).length),
    length: average((value) => value.length),
  };
}

/** Row numbers (1, 2, 3…) copied along with the data */
function isCounter(values: string[]): boolean {
  if (values.length < 3 || !values.every((value) => /^\d{1,5}$/.test(value))) return false;
  return values.every((value, i) => i === 0 || Number(value) === Number(values[i - 1]) + 1);
}

function byContent(draft: ColumnDraft): ColumnTarget | 'text' {
  const stats = draft.profile;
  if (stats.email >= 0.6) return 'email';
  if (stats.phone >= 0.6) return 'phone';
  if (stats.website >= 0.6) return 'website';
  if (stats.method >= 0.6) return 'method';
  if (isCounter(draft.values)) return 'skip';
  if (stats.numeric >= 0.6) return 'notes';
  return 'text';
}

function assignTargets(columns: ColumnDraft[]) {
  for (const column of columns) {
    const { headerMatch: match, profile: stats } = column;
    if (stats.count === 0) {
      column.target = 'skip';
      continue;
    }
    if (match) {
      const content = byContent(column);
      if (match.target === 'skip') {
        column.target = content === 'phone' || content === 'email' ? content : 'skip';
        continue;
      }
      const agreement: Partial<Record<ColumnTarget, number>> = {
        phone: stats.phone,
        email: stats.email,
        website: stats.website,
        method: stats.method,
      };
      const share = agreement[match.target];
      if (share === undefined || share >= 0.5) {
        column.target = match.target;
        column.loose = match.loose;
        continue;
      }
      // The header and the values disagree, like a "Source" column full of "Facebook": keep the values as notes.
      column.target = match.target === 'method' ? 'notes' : content;
      continue;
    }
    column.target = byContent(column);
  }

  // A business column takes "name"; "Name" alone then becomes the contact person.
  const named = columns.filter((column) => column.target === 'name');
  const business = named.find((column) => !column.loose) ?? named[0];
  for (const column of named) {
    if (column !== business) column.target = column.loose ? 'contactName' : 'notes';
  }

  let hasName = Boolean(business);
  let hasContact = columns.some((column) => column.target === 'contactName');
  for (const column of columns) {
    if (column.target !== 'text') continue;
    if (!hasName) {
      column.target = 'name';
      hasName = true;
    } else if (!hasContact && column.profile.words <= 3.2 && column.profile.length <= 30) {
      column.target = 'contactName';
      hasContact = true;
    } else {
      column.target = 'notes';
    }
  }
}

function readCells(cells: string[], targets: readonly ColumnTarget[], columns: ImportColumn[], key: string): ParsedRow {
  const row = emptyRow(key);
  const names: string[] = [];
  const contacts: string[] = [];
  const notes: string[] = [];

  targets.forEach((target, index) => {
    const value = (cells[index] ?? '').trim();
    if (!value || target === 'skip') return;
    const header = columns[index]?.header;
    // Values that can't be read keep their column name, so nothing pasted is lost.
    const keepAsNote = () => notes.push(header && !isNotesHeader(header) ? `${header}: ${value}` : value);

    switch (target) {
      case 'name':
        names.push(value);
        break;
      case 'contactName':
        contacts.push(value);
        break;
      case 'phone': {
        const phone = readPhone(value, true) ?? findPhones(value)[0]?.phone;
        if (phone && !row.phone) row.phone = phone;
        else keepAsNote();
        break;
      }
      case 'email': {
        const email = findEmail(value);
        if (email && !row.email) row.email = email;
        else keepAsNote();
        break;
      }
      case 'website': {
        const website = readWebsite(value);
        if (website && !row.website) row.website = website;
        else keepAsNote();
        break;
      }
      case 'campaign':
        if (!row.campaign) row.campaign = value.slice(0, 60);
        else keepAsNote();
        break;
      case 'approach':
        row.approach = row.approach ? `${row.approach}
${value}` : value;
        break;
      case 'method': {
        const method = matchChannel(value);
        if (method && !row.method) row.method = method;
        else keepAsNote();
        break;
      }
      case 'notes':
        keepAsNote();
        break;
    }
  });

  row.name = names.join(' ');
  row.contactName = contacts.join(' ');
  if (!row.name && row.contactName) {
    row.name = row.contactName;
    row.contactName = '';
  }
  row.notes = notes.join('\n');
  return row;
}

// ─── Text lists ──────────────────────────────────────────────────────────────

const LIST_MARKER = /^\s*(?:[-*•·◦▪▸►✓✔☐☑–—]+|\(?\d{1,4}[.)\]]|#\d{1,4})\s+/;
const SEGMENT_BREAK = /\t|\||;|,|\s+[-–—]+\s+|\s+\/\s+|\s+[·•]\s+/;

function splitSegments(line: string): string[] {
  return line
    .split(SEGMENT_BREAK)
    .map((segment) => segment.replace(/^[\s\-–—:;,.]+|[\s\-–—:;,]+$/g, '').trim())
    .filter((segment) => /[\p{L}\p{N}]/u.test(segment));
}

/** A line that already holds a whole lead: a name next to a phone or email */
function isCompleteLine(line: string): boolean {
  const { phones, emails, rest } = takeContacts(line);
  return phones.length + emails.length > 0 && /\p{L}{2,}/u.test(rest);
}

/** Leads written as paragraphs: name, then phone, then email, with a blank line between leads. */
function readBlocks(text: string): string[][] | null {
  if (!/\n[ \t]*\n/.test(text)) return null;
  const blocks = text
    .split(/\n[ \t]*\n+/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length > 0);
  if (blocks.length < 2) return null;
  const lines = blocks.flat();
  // When most lines hold a whole lead, the blank lines are only spacing.
  if (lines.filter(isCompleteLine).length >= lines.length / 2) return null;
  if (blocks.filter((block) => block.length > 1).length < blocks.length / 2) return null;
  return blocks;
}

function readRecord(lines: string[], key: string): ParsedRow {
  const row = emptyRow(key);
  const extras: string[] = [];
  const segments: string[] = [];

  for (const raw of lines) {
    const { phones, emails, websites, rest } = takeContacts(raw.replace(LIST_MARKER, ''));
    for (const website of websites) {
      if (!row.website) row.website = website;
      else extras.push(website);
    }
    for (const phone of phones) {
      if (!row.phone) row.phone = phone;
      else extras.push(phone);
    }
    for (const email of emails) {
      if (!row.email) row.email = email;
      else extras.push(email);
    }
    const line = rest
      .replace(/\(([^()]*)\)/g, ' | $1 | ');
    segments.push(...splitSegments(line));
  }

  const text: string[] = [];
  for (const segment of segments) {
    // "Contact: Moshe", "סטטוס: לא ענה"
    const labelled = /^([^:]{2,30}):\s*(.+)$/.exec(segment);
    const label = labelled ? headerField(labelled[1]) : null;
    if (labelled && label) {
      setField(row, label.target, labelled[2].trim(), extras);
      continue;
    }
    // A channel word on its own ("whatsapp"), checked before labels since "WhatsApp" is also a phone column name
    const method = row.method ? null : matchChannel(segment, false);
    if (method && !(method === 'call' && headerField(segment))) {
      row.method = method;
      continue;
    }
    if (headerField(segment)) continue; // a label left behind after its number was taken: "Phone:", "טל'"
    text.push(segment);
  }

  const queue = [...text];
  if (!row.name) {
    // "Moshe Azulay - Arbel Olive Press": the business goes first.
    if (queue.length >= 2 && isBusinessLike(queue[1]) && !isBusinessLike(queue[0]) && isPersonName(queue[0])) {
      [queue[0], queue[1]] = [queue[1], queue[0]];
    }
    row.name = queue.shift() ?? '';
  }
  if (!row.contactName && queue.length > 0 && isPersonName(queue[0])) row.contactName = queue.shift() ?? '';
  if (!row.name && row.contactName) {
    row.name = row.contactName;
    row.contactName = '';
  }
  row.notes = [...queue, ...extras].join(', ');
  return row;
}

function setField(row: ParsedRow, target: ColumnTarget, value: string, extras: string[]) {
  switch (target) {
    case 'name':
      if (!row.name) row.name = value;
      else extras.push(value);
      break;
    case 'contactName':
      if (!row.contactName) row.contactName = value;
      else extras.push(value);
      break;
    case 'phone': {
      const phone = readPhone(value, true);
      if (phone && !row.phone) row.phone = phone;
      break;
    }
    case 'email': {
      const email = findEmail(value);
      if (email && !row.email) row.email = email;
      break;
    }
    case 'website': {
      const website = readWebsite(value);
      if (website && !row.website) row.website = website;
      break;
    }
    case 'campaign':
      if (!row.campaign) row.campaign = value.slice(0, 60);
      break;
    case 'approach':
      row.approach = row.approach ? `${row.approach} ${value}` : value;
      break;
    case 'method':
      row.method ??= matchChannel(value);
      break;
    case 'notes':
      extras.push(value);
      break;
    case 'skip':
      break;
  }
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
