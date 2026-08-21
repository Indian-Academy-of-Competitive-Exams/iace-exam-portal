/** Dates of birth: impossible days, and what the template does to Excel's formatting. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import {
  EARLIEST_BIRTH_DATE,
  EARLIEST_BIRTH_YEAR,
  STUDENT_IMPORT_COLUMNS,
  dobSchema,
} from '@iace/contracts';
import { buildStudentTemplate } from '../src/imports/workbook';
import { normaliseHeader, readUploadedTable } from '../src/common/importing';

const DOB_INDEX = STUDENT_IMPORT_COLUMNS.findIndex((column) => column.key === 'dob') + 1;

describe('dobSchema', () => {
  it('takes a real date', () => {
    assert.equal(dobSchema.safeParse('1998-07-14').success, true);
  });

  it('refuses a day that does not exist in that month', () => {
    for (const impossible of ['1998-02-31', '1998-02-30', '1998-04-31', '1998-06-31']) {
      const result = dobSchema.safeParse(impossible);
      assert.equal(result.success, false, `${impossible} was accepted`);
    }
  });

  it('refuses 29 February outside a leap year, and keeps it inside one', () => {
    assert.equal(dobSchema.safeParse('1998-02-29').success, false);
    assert.equal(dobSchema.safeParse('1996-02-29').success, true);
  });

  it('never silently shifts a date it accepts', () => {
    for (const value of ['1996-02-29', '2000-12-31', '1900-01-01']) {
      const result = dobSchema.safeParse(value);
      assert.equal(result.success && result.data, value);
    }
  });

  it('agrees with the floor the pickers are bounded by', () => {
    assert.equal(dobSchema.safeParse(EARLIEST_BIRTH_DATE).success, true);
    const dayBefore = new Date(`${EARLIEST_BIRTH_DATE}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    assert.equal(dobSchema.safeParse(dayBefore.toISOString().slice(0, 10)).success, false);
  });

  it('still refuses the future and the implausible past', () => {
    assert.equal(dobSchema.safeParse('2099-01-01').success, false);
    assert.equal(dobSchema.safeParse(`${EARLIEST_BIRTH_YEAR - 1}-01-01`).success, false);
  });
});

describe('the student template', () => {
  it('types the date column as a date, so Excel cannot hand back dd/mm as text', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildStudentTemplate()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Students');
    assert.ok(sheet);

    const example = sheet.getCell(2, DOB_INDEX).value;
    assert.ok(example instanceof Date, 'the sample row must carry a real date, not a string');
    assert.equal(sheet.getColumn(DOB_INDEX).numFmt, 'yyyy-mm-dd');
  });

  it('makes Excel itself refuse an out-of-range birth date', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildStudentTemplate()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Students');
    assert.ok(sheet);

    const rule = sheet.getCell(2, DOB_INDEX).dataValidation;
    assert.equal(rule?.type, 'date');
    assert.equal(rule?.allowBlank, true, 'date of birth is optional and must stay optional');
    assert.equal(rule?.showErrorMessage, true);
  });

  it('reads its own sample row back as the day it was written', async () => {
    const table = await readUploadedTable(await buildStudentTemplate());
    const first = table.rows[0];
    assert.ok(first);
    assert.equal(first.values[normaliseHeader('Date of Birth')], '2003-04-11');
  });
});
