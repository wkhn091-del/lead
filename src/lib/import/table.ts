/**
 * Splits delimited text into rows of cells, quoting the way Excel and CSV files do:
 * a cell that starts with " may hold delimiters, line breaks, and "" for a quote mark.
 * Returns null when a quote is never closed.
 */
function parseQuoted(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (char === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
      atCellStart = true;
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
    } else if (atCellStart && char === ' ') {
      // Leading spaces before an opening quote: `a, "b, c"`
    } else {
      cell += char;
      atCellStart = false;
    }
  }
  if (quoted) return null;
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Rows of cells, falling back to a plain split when the quotes don't balance. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  return parseQuoted(text, delimiter) ?? text.split('\n').map((line) => line.split(delimiter));
}
