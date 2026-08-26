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
import { normaliseHeader, readUploadedTable, toIsoDate } from '../src/common/importing';

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

describe('toIsoDate', () => {
  it('takes what Excel writes back after it reformats a typed date', () => {
    for (const raw of ['2003-04-11', '2003/04/11', '2003.04.11']) {
      assert.equal(toIsoDate(raw), '2003-04-11');
    }
  });

  it('takes a day-first date whatever separates it', () => {
    for (const raw of ['11/04/2003', '11-04-2003', '11.04.2003']) {
      assert.equal(toIsoDate(raw), '2003-04-11');
    }
  });

  it('reads a named month either way round, so no order has to be guessed', () => {
    for (const raw of ['11-Apr-2003', '11 April 2003', 'April 11, 2003', 'Apr 11 2003']) {
      assert.equal(toIsoDate(raw), '2003-04-11');
    }
  });

  it('uses the part that cannot be a month as the day', () => {
    assert.equal(toIsoDate('04/25/2003'), '2003-04-25');
    assert.equal(toIsoDate('25/04/2003'), '2003-04-25');
  });

  it('reads day-first when both parts could be a month, as this institute writes them', () => {
    assert.equal(toIsoDate('04/11/2003'), '2003-11-04');
  });

  it('decodes a bare Excel serial', () => {
    assert.equal(toIsoDate('37722'), '2003-04-11');
  });

  it('leaves a stray small number alone rather than calling it 1900', () => {
    assert.equal(toIsoDate('5'), '5');
    assert.equal(dobSchema.safeParse(toIsoDate('5')).success, false);
  });

  it('hands anything it cannot read straight back, for the schema to refuse', () => {
    for (const raw of ['yesterday', '', 'Q3 2003']) assert.equal(toIsoDate(raw), raw);
  });

  it('never turns an impossible date into a real one', () => {
    assert.equal(dobSchema.safeParse(toIsoDate('31/02/2003')).success, false);
  });
});

describe('a date typed into the template', () => {
  /** What Excel actually stores: a serial carrying a display format, per the typist's locale. */
  const DOB_COLUMN = STUDENT_IMPORT_COLUMNS.findIndex((column) => column.key === 'dob') + 1;
  const SERIAL_11_APRIL_2003 = 37722;

  const roundTrip = async (displayFormat: string): Promise<string> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildStudentTemplate()) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Students');
    assert.ok(sheet);

    const row = sheet.getRow(5);
    row.getCell(1).value = '9876500000';
    const cell = row.getCell(DOB_COLUMN);
    cell.value = SERIAL_11_APRIL_2003 as never;
    cell.numFmt = displayFormat;
    row.commit();

    const table = await readUploadedTable(Buffer.from(await workbook.xlsx.writeBuffer()));
    const raw = table.rows.at(-1)?.values[normaliseHeader('Date of Birth')] ?? '';
    return toIsoDate(raw);
  };

  it('survives whatever format Excel redraws it in', async () => {
    for (const displayFormat of [
      'dd/mm/yyyy',
      'mm/dd/yyyy',
      'yyyy-mm-dd',
      'dd.mm.yyyy',
      '[$-409]d-mmm-yy;@',
    ]) {
      assert.equal(await roundTrip(displayFormat), '2003-04-11', `broke on ${displayFormat}`);
    }
  });

  it('stores a day the schema accepts, not just a string that parses', async () => {
    const result = dobSchema.safeParse(await roundTrip('mm/dd/yyyy'));
    assert.equal(result.success && result.data, '2003-04-11');
  });
});

describe('toIsoDate — a cell that arrived as a Date', () => {
  /** The failure this prevents: a zone ahead of UTC landing every date of birth a day early. */
  it('reads the civil date off the cell, not off an instant', () => {
    assert.equal(toIsoDate(new Date(Date.UTC(2004, 8, 1))), '2004-09-01');
    assert.equal(toIsoDate(new Date(Date.UTC(2004, 0, 31, 23, 59, 59))), '2004-01-31');
  });

  it('agrees with the same date written out as text', () => {
    assert.equal(toIsoDate(new Date(Date.UTC(1999, 11, 31))), toIsoDate('31/12/1999'));
  });
});
