import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCsvTable, readUploadedTable } from '../src/common/importing';
import { buildProgramTemplate } from '../src/imports/workbook';
import { planProgramImport, type ProgramImportContext } from '../src/imports/program-import';
import { roster } from './support/fakes';

/** A program is something an ENROLLED student carries, so this sheet enrols and never creates. */

const PROGRAM = 'SSC FOUNDATION';

const context = (over: Partial<ProgramImportContext> = {}): ProgramImportContext => ({
  studentsByMobile: new Map([
    ['9000000001', { id: 'stu_plain', fullName: 'Asha Kumari', programs: [] }],
    ['9000000002', { id: 'stu_carries', fullName: 'Ravi Teja', programs: [PROGRAM] }],
  ]),
  programCode: PROGRAM,
  ...over,
});

describe('the program enrolment sample', () => {
  /** A sample that documents a format the parser rejects is worse than no sample at all. */
  it('parses cleanly through the importer it was generated for', async () => {
    const table = await readUploadedTable(await buildProgramTemplate());

    const plan = planProgramImport(table, {
      studentsByMobile: new Map(),
      programCode: PROGRAM,
    });

    assert.deepEqual(plan.fileErrors, []);
    // Nobody in the sample is on the platform, so every row is the skip this importer is built on.
    assert.equal(plan.summary.total, plan.summary.invalid);
  });
});

describe('planProgramImport', () => {
  it('enrols a student who does not carry it and leaves one who already does', () => {
    const plan = planProgramImport(
      readCsvTable(roster('mobile,fullName\n9000000001,Asha\n9000000002,Ravi')),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willEnrol: 1, alreadyEnrolled: 1, invalid: 0 });
    assert.equal(plan.rows[0]?.action, 'enrol');
    assert.equal(plan.rows[0]?.studentId, 'stu_plain');
    assert.equal(plan.rows[1]?.action, 'already');
  });

  /** The rule the whole importer exists to hold: an unknown number is reported, never created. */
  it('skips a number no student holds rather than creating one', () => {
    const plan = planProgramImport(
      readCsvTable(roster('mobile,fullName\n9876543210,Nobody')),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 1, willEnrol: 0, alreadyEnrolled: 0, invalid: 1 });
    assert.equal(plan.rows[0]?.action, 'skip');
    assert.equal(plan.rows[0]?.studentId, null);
    assert.match(plan.rows[0]?.errors[0] ?? '', /No student on that number/);
  });

  it('names the student on record, not the name the sheet supplied', () => {
    const plan = planProgramImport(
      readCsvTable(roster('mobile,fullName\n9000000001,Typo In The Sheet')),
      context(),
    );

    assert.equal(plan.rows[0]?.fullName, 'Typo In The Sheet');
    assert.equal(plan.rows[0]?.studentName, 'Asha Kumari');
  });

  /** Two rows for one student would enrol them, then push the code a second time. */
  it('reports a number repeated in the file against the line that had it first', () => {
    const plan = planProgramImport(
      readCsvTable(roster('mobile,fullName\n9000000001,Asha\n9000000001,Asha again')),
      context(),
    );

    assert.equal(plan.summary.willEnrol, 1);
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.match(plan.rows[1]?.errors[0] ?? '', /already on line 2/);
  });

  it('refuses a file with no mobile column, and reads no rows from it', () => {
    const plan = planProgramImport(readCsvTable(roster('fullName\nAsha')), context());

    assert.equal(plan.rows.length, 0);
    assert.match(plan.fileErrors[0] ?? '', /no Mobile Number column/i);
  });
});
