/** The rows an import refused, handed back as the admin uploaded them with an Errors column. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { readUploadedTable, rowsWithErrors } from '../src/common/importing';
import { writeWorkbook } from '../src/common/exporting';

const CSV = [
  'Mobile,Full Name,DOB',
  '9876500001,Asha,2001-01-01',
  '9876500002,Bhanu,31/02/99',
  '9876500003,Chitra,2002-02-02',
  '98765,Devi,2003-03-03',
  '9876500005,Esha,2004-04-04',
].join('\n');

/** What an admin would see opening the download: its header row and its data rows. */
async function opened(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const rows: string[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map((value) => String(value ?? '')));
  });
  return rows;
}

describe('rowsWithErrors', () => {
  it('keeps only the failing lines, their cells as uploaded, their errors last', async () => {
    const table = await readUploadedTable(Buffer.from(CSV));
    const sheet = rowsWithErrors(
      table,
      new Map([
        [2, []],
        [3, ['That is not a real date of birth']],
        [5, ['That is not a mobile number we can enter', 'Too short']],
      ]),
    );

    assert.deepEqual(await opened(await writeWorkbook([sheet])), [
      ['Mobile', 'Full Name', 'DOB', 'Errors'],
      ['9876500002', 'Bhanu', '31/02/99', 'That is not a real date of birth'],
      ['98765', 'Devi', '2003-03-03', 'That is not a mobile number we can enter; Too short'],
    ]);
  });

  it('is headers only when no line has an error', async () => {
    const table = await readUploadedTable(Buffer.from(CSV));
    assert.deepEqual(await opened(await writeWorkbook([rowsWithErrors(table, new Map())])), [
      ['Mobile', 'Full Name', 'DOB', 'Errors'],
    ]);
  });

  it('replaces the Errors column of a download uploaded again, and reads back as the same table', async () => {
    const first = await writeWorkbook([
      rowsWithErrors(await readUploadedTable(Buffer.from(CSV)), new Map([[3, ['old']]])),
    ]);
    const again = await readUploadedTable(first);
    const second = await writeWorkbook([rowsWithErrors(again, new Map([[2, ['new']]]))]);

    assert.deepEqual(await opened(second), [
      ['Mobile', 'Full Name', 'DOB', 'Errors'],
      ['9876500002', 'Bhanu', '31/02/99', 'new'],
    ]);
  });
});
