/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than a dependency because the failure modes are ones we
 * can enumerate, and every one of them below comes from a real spreadsheet:
 * Excel writes a UTF-8 BOM, Windows writes CRLF, and any field a human typed
 * may be quoted with commas, newlines or doubled quotes inside it. Getting
 * those wrong does not throw — it silently shifts every column right, which is
 * the worst way for an import to fail.
 */

/** A parsed row, carrying the line it actually came from. */
export interface RawCsvRow {
  /** 1-based line in the source file, counting blank lines that were dropped. */
  line: number;
  cells: string[];
}

/**
 * Splits into rows of raw cells, keeping each row's TRUE line number.
 *
 * The line number cannot be derived from the row's index afterwards: blank
 * lines are dropped, so every row after one would be reported one line early —
 * and an error pointing at the wrong row is worse than one pointing nowhere.
 */
export function parseCsvRows(input: string): RawCsvRow[] {
  // Excel prefixes UTF-8 files with a BOM; left in place it becomes part of the
  // first header name, and "﻿mobile" matches nothing.
  const text = input.replace(/^﻿/, '');

  const rows: RawCsvRow[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  // The line this row STARTED on — a quoted field may span several.
  let line = 1;
  let lineOfRowStart = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote, not the end of it.
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line++;
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a CRLF so it does not open a second, empty row.
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push({ line: lineOfRowStart, cells: row });
      row = [];
      line++;
      lineOfRowStart = line;
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push({ line: lineOfRowStart, cells: row });

  return rows;
}

/** The cells alone, where the line numbers are not needed. */
export function parseCsv(input: string): string[][] {
  return parseCsvRows(input).map((row) => row.cells);
}

/**
 * Turns the sheet into objects keyed by header name, keeping the 1-based line
 * number of each row — an error that cannot say "line 42" is not actionable
 * against a 400-row file.
 */
export interface CsvRow {
  /** 1-based line in the original file, exactly as an editor shows it. */
  line: number;
  values: Record<string, string>;
}

export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
}

/** Header names are matched case- and space-insensitively: "Full Name" = "fullname". */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function readCsvTable(input: string): CsvTable {
  const grid = parseCsvRows(input);
  if (grid.length === 0) return { headers: [], rows: [] };

  const headers = (grid[0]?.cells ?? []).map(normaliseHeader);

  const rows = grid.slice(1).map(({ line, cells }) => ({
    // Straight from the parser, so a blank line in the middle of the file does
    // not shift every number after it.
    line,
    values: Object.fromEntries(
      headers.map((header, column) => [header, (cells[column] ?? '').trim()]),
    ),
  }));

  return { headers, rows };
}
