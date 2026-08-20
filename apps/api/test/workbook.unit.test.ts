import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { AppException, STUDENT_IMPORT_COLUMNS } from '@iace/contracts';
import { looksLikeWorkbook, readUploadedTable } from '../src/common/importing';
import { buildStudentTemplate } from '../src/imports/workbook';
import { columnValue } from '../src/imports/student-import';

/** Builds a real .xlsx in memory — no fixture files, no disk. */
async function workbook(rows: unknown[][], sheetName = 'Students'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('readUploadedTable — Excel', () => {
  it('reads a sheet into headers and rows', async () => {
    const table = await readUploadedTable(
      await workbook([
        ['mobile', 'fullName', 'groups'],
        ['9876543210', 'Asha Kumari', 'SSC CGL MORNING'],
      ]),
    );

    assert.deepEqual(table.headers, ['mobile', 'fullname', 'groups']);
    assert.deepEqual(table.rows[0]?.values, {
      mobile: '9876543210',
      fullname: 'Asha Kumari',
      groups: 'SSC CGL MORNING',
    });
  });

  /** The failure this exists to prevent. */
  it('reads a mobile stored as a number as plain digits', async () => {
    const table = await readUploadedTable(
      await workbook([
        ['mobile', 'fullName'],
        [9876543210, 'Asha'],
      ]),
    );

    assert.equal(table.rows[0]?.values.mobile, '9876543210');
  });

  it('matches headers however they were capitalised or spaced', async () => {
    const table = await readUploadedTable(
      await workbook([
        ['Mobile', 'Full Name', ' GROUPS '],
        ['9876543210', 'Asha', 'X'],
      ]),
    );

    assert.deepEqual(table.headers, ['mobile', 'fullname', 'groups']);
  });

  /** Row numbers must be the ones Excel shows. */
  it('reports the sheet row number, not a count of the rows it kept', async () => {
    const table = await readUploadedTable(
      await workbook([['mobile'], ['9876543210'], [''], ['9876543211']]),
    );

    assert.deepEqual(
      table.rows.map((row) => row.line),
      [2, 4],
    );
  });

  it('drops a wholly empty row rather than reporting it as broken', async () => {
    const table = await readUploadedTable(
      await workbook([
        ['mobile', 'fullName'],
        ['9876543210', 'Asha'],
        ['', ''],
      ]),
    );

    assert.equal(table.rows.length, 1);
  });

  it('takes the first sheet whatever it is called', async () => {
    const table = await readUploadedTable(
      await workbook([['mobile'], ['9876543210']], 'Sheet renamed by someone'),
    );

    assert.equal(table.rows.length, 1);
  });
});

describe('readUploadedTable — what it accepts', () => {
  /**
   * Sniffed from the bytes, not the filename: a .csv renamed to .xlsx is still a CSV, and the
   * spreadsheet reader's error for one is unreadable.
   */
  it('still reads a CSV, whatever it was called', async () => {
    const table = await readUploadedTable(Buffer.from('mobile,fullName\n9876543210,Asha\n'));

    assert.deepEqual(table.headers, ['mobile', 'fullname']);
    assert.equal(table.rows[0]?.values.mobile, '9876543210');
  });

  it('tells a workbook from anything else by its bytes', async () => {
    assert.equal(looksLikeWorkbook(await workbook([['mobile']])), true);
    assert.equal(looksLikeWorkbook(Buffer.from('mobile,fullName\n')), false);
  });

  it('refuses an empty upload with a message rather than a crash', async () => {
    await assert.rejects(
      () => readUploadedTable(Buffer.alloc(0)),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /empty/i);
        return true;
      },
    );
  });

  /**
   * A JPEG named .xlsx used to reach the CSV reader and come back as `needs a "mobile" column.
   * Found: ����notanexcel` — the wrong problem, described in unreadable characters.
   */
  it('refuses another binary format wearing an .xlsx name', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

    await assert.rejects(
      () => readUploadedTable(jpeg),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /not a spreadsheet/i);
        return true;
      },
    );
  });

  it('refuses a corrupt workbook with a message an admin can act on', async () => {
    // ZIP magic, then nothing a reader can use.
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);

    await assert.rejects(
      () => readUploadedTable(broken),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /\.xlsx/);
        return true;
      },
    );
  });
});

describe('buildStudentTemplate', () => {
  /** The sample is generated from the same column list the parser matches on. */
  it('produces a file this importer can actually read back', async () => {
    const table = await readUploadedTable(await buildStudentTemplate());

    // Asserted against the column definitions rather than a literal list, so
    // renaming a header cannot pass this test while breaking the importer.
    for (const column of STUDENT_IMPORT_COLUMNS) {
      assert.ok(
        column.aliases.some((alias) => table.headers.includes(alias)),
        `the sample's "${column.header}" header must be one the parser accepts`,
      );
    }

    assert.ok(table.rows.length > 0, 'the sample must show at least one example row');
    assert.equal(columnValue(table.rows[0]!, 'mobile'), '9876543210');
  });

  /**
   * The headers are read by office staff filling the sheet in, not by us. A camelCase header row
   * asks them to read our variable names.
   */
  it('names its columns the way a person would', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildStudentTemplate()) as unknown as ArrayBuffer);
    const header = workbook.worksheets[0]?.getRow(1);

    assert.equal(header?.getCell(1).value, 'Mobile Number');
    assert.equal(header?.getCell(2).value, 'Full Name');
  });

  it('is a workbook, not a CSV with a misleading name', async () => {
    assert.equal(looksLikeWorkbook(await buildStudentTemplate()), true);
  });
});
