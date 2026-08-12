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
  // first header name, so the "mobile" column matches nothing.
  const text = input.replace(/^\uFEFF/, '');

  const rows: RawCsvRow[] = [];
  let row: string[] = [];
  let cell = '';
  let line = 1;
  // The line this row STARTED on — a quoted field may span several.
  let rowStartedOn = 1;

  /** Ends the current row, keeping it only if it holds something. */
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.trim() !== '')) rows.push({ line: rowStartedOn, cells: row });
    row = [];
  };

  // A `while` rather than a `for`: a quoted field and a CRLF both consume more
  // than one character, and a loop that advances its own cursor is clearer than
  // one whose counter is reassigned from inside the body.
  let i = 0;
  while (i < text.length) {
    const char = text[i];

    // A quote only opens a field at the START of one; anywhere else it is data.
    if (char === '"' && cell === '') {
      const field = readQuotedField(text, i);
      cell += field.value;
      line += field.newlines;
      i = field.endsAt + 1;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a CRLF so it does not open a second, empty row.
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowStartedOn = line;
    } else {
      cell += char;
    }

    i++;
  }

  endRow();
  return rows;
}

/**
 * Reads one quoted field, from its opening quote to its closing one.
 *
 * Pulled out of the loop above because it carried its own state — a `quoted`
 * flag, an escape case and a newline count — and interleaving that with the
 * unquoted path made a scanner nobody could hold in their head. `newlines` is
 * returned rather than counted by the caller: a quoted field may span lines,
 * and losing that count is how every error after it points at the wrong row.
 *
 * An unterminated field (a stray quote in a hand-edited file) runs to the end
 * of the input and stops there, which keeps whatever the author typed rather
 * than throwing away the rest of their file.
 */
function readQuotedField(
  text: string,
  openingQuote: number,
): { value: string; endsAt: number; newlines: number } {
  let value = '';
  let newlines = 0;

  for (let i = openingQuote + 1; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      // "" inside a quoted field is a literal quote, not the end of it.
      if (text[i + 1] === '"') {
        value += '"';
        i++;
        continue;
      }
      return { value, endsAt: i, newlines };
    }

    if (char === '\n') newlines++;
    value += char;
  }

  return { value, endsAt: text.length, newlines };
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
