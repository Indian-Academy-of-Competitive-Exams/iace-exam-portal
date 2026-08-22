import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BRANCH_TYPE, STUDENT_IMPORT_COLUMNS } from '@iace/contracts';
import { normaliseHeader, readCsvTable } from '../src/common/importing';
import { planStudentImport, type ImportContext } from '../src/imports/student-import';
import {
  fetchPortalRoster,
  portalTable,
  PORTAL_NOT_CONFIGURED,
} from '../src/imports/portal-roster';
import { roster } from './support/fakes';

const context = (): ImportContext => ({
  existingByMobile: new Map([
    ['9000000001', { id: 'stu_existing', fullName: 'Already Here', hasPin: true }],
  ]),
  branchByName: new Map([['AMEERPET', { id: 'br_ameerpet', type: BRANCH_TYPE.PHYSICAL }]]),
  examCodes: new Set(['SSC CGL']),
  programCodes: new Set(['SSC FOUNDATION']),
});

describe('portalTable', () => {
  /** The point of the whole design: one planner, so the two sources cannot disagree about a row. */
  it('is judged by the same planner as an uploaded sheet, to the same verdict', () => {
    const fromSheet = planStudentImport(
      readCsvTable(roster('Mobile Number,Full Name\n9000000003,Asha')),
      context(),
    );
    const fromPortal = planStudentImport(
      portalTable([
        {
          mobile: '9000000003',
          fullName: 'Asha',
          studentType: 'ONLINE',
          branchName: 'ONLINE',
          enrolledFamilies: 'SSC',
        },
      ]),
      context(),
    );

    assert.deepEqual(fromPortal.summary, fromSheet.summary);
    assert.deepEqual(fromPortal.rows[0]?.errors, fromSheet.rows[0]?.errors);
    assert.equal(fromPortal.rows[0]?.action, fromSheet.rows[0]?.action);
  });

  /** A discrepancy the portal sent is reported against a line, or nobody can tell which student. */
  it('reports a bad row against a line number, counting the header as line 1', () => {
    const plan = planStudentImport(
      portalTable([
        { mobile: '9000000003', studentType: 'ONLINE', branchName: 'NOWHERE' },
        { mobile: 'not-a-number', studentType: 'ONLINE', branchName: 'ONLINE' },
      ]),
      context(),
    );

    assert.equal(plan.rows[0]?.line, 2);
    assert.equal(plan.rows[1]?.line, 3);
    assert.ok(plan.summary.invalid > 0, 'a roster this wrong must not import silently');
  });

  it('carries every column the sheet does, so no field is quietly undeliverable', () => {
    const table = portalTable([{ mobile: '9000000003' }]);

    for (const column of STUDENT_IMPORT_COLUMNS) {
      const header = normaliseHeader(column.header);
      assert.ok(table.headers.includes(header), `${column.key} is missing from the portal table`);
      assert.ok(
        column.aliases.includes(header as never),
        `${column.key} normalises to "${header}", which columnValue does not look up`,
      );
    }
  });
});

describe('fetchPortalRoster', () => {
  /** Unreachable is wrong with the SOURCE — blaming rows that were never returned helps nobody. */
  it('reports being unconfigured as a source error, with no rows', async () => {
    const fetched = await fetchPortalRoster();

    assert.deepEqual(fetched.errors, [PORTAL_NOT_CONFIGURED]);
    assert.equal(fetched.table.rows.length, 0);
  });

  it('keeps the payload, so a disagreement is settled against what the portal sent', async () => {
    const fetched = await fetchPortalRoster();

    assert.ok(fetched.payload.length > 0, 'the run must store something to look at later');
  });
});
