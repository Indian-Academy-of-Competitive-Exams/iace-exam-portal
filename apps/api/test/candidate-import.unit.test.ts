import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCsvTable, readUploadedTable } from '../src/common/importing';
import { buildCandidateTemplate } from '../src/imports/workbook';
import { planCandidateImport, type CandidateImportContext } from '../src/imports/candidate-import';
import { roster } from './support/fakes';

/** A candidate sheet is an intake list, not a roster: a number we know only JOINS the event. */

const context = (over: Partial<CandidateImportContext> = {}): CandidateImportContext => ({
  existingByMobile: new Map([['9000000001', { id: 'stu_existing', hasPin: true }]]),
  deletedMobiles: new Set<string>(),
  ...over,
});

describe('the candidate sample', () => {
  /** A sample that documents a format the parser rejects is worse than no sample at all. */
  it('parses cleanly through the importer it was generated for', async () => {
    const table = await readUploadedTable(await buildCandidateTemplate());

    const plan = planCandidateImport(table, {
      existingByMobile: new Map(),
      deletedMobiles: new Set(),
    });

    assert.deepEqual(plan.fileErrors, []);
    assert.equal(plan.summary.invalid, 0);
    assert.equal(plan.summary.total, plan.summary.willCreate);
  });
});

describe('planCandidateImport', () => {
  /** The whole split: a candidate we know only joins, one we do not is created and then joins. */
  it('adds a number we know and creates one we do not', () => {
    const plan = planCandidateImport(
      readCsvTable(roster('mobile,fullName\n9000000001,Asha\n9876543210,Ravi')),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willAdd: 1, invalid: 0 });
    assert.equal(plan.rows[0]?.action, 'add');
    assert.equal(plan.rows[0]?.existingStudentId, 'stu_existing');
    assert.equal(plan.rows[1]?.action, 'create');
    assert.equal(plan.rows[1]?.existingStudentId, null);
  });

  /** An existing student keeps the PIN they chose; only a new candidate is handed one. */
  it('hands a starting PIN to the new candidate alone', () => {
    const plan = planCandidateImport(
      readCsvTable(roster('mobile,fullName\n9000000001,Asha\n9876543210,Ravi')),
      context(),
    );

    assert.equal(plan.rows[0]?.willReceiveDefaultPin, false);
    assert.equal(plan.rows[1]?.willReceiveDefaultPin, true);
  });

  /** Unique among LIVE rows only, so a create would succeed and split one person across two accounts. */
  it('fails a number that belonged to a deleted student', () => {
    const plan = planCandidateImport(
      readCsvTable(roster('mobile,fullName\n9111111111,Asha')),
      context({ deletedMobiles: new Set(['9111111111']) }),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors[0] ?? '', /deleted/);
    assert.equal(plan.summary.invalid, 1);
  });

  it('takes the same number once and names the line it repeats', () => {
    const plan = planCandidateImport(
      readCsvTable(roster('mobile,fullName\n9876543210,Asha\n9876543210,Asha again')),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.match(plan.rows[1]?.errors[0] ?? '', /line 2/);
  });

  it('skips one bad number and keeps the rest of the file', () => {
    const plan = planCandidateImport(
      readCsvTable(roster('mobile,fullName\n9876543210,Good\nnot-a-number,Bad')),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willAdd: 0, invalid: 1 });
  });

  it('blames the file, not a row, when there is no mobile column', () => {
    const plan = planCandidateImport(readCsvTable(roster('name\nAsha')), context());

    assert.deepEqual(plan.rows, []);
    assert.match(plan.fileErrors[0] ?? '', /Mobile Number/);
  });
});
