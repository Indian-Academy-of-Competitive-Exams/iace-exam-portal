import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIRECT_GRANT_MESSAGE, GROUP_TYPE } from '@iace/contracts';
import { readCsvTable } from '../src/common/importing';
import {
  mobilesInMemberFile,
  planGroupMemberImport,
  type GroupMemberContext,
} from '../src/imports/group-member-import';

const context = (): GroupMemberContext => ({
  group: { id: 'g1', name: 'MERIT 2026', examType: null, type: GROUP_TYPE.SCHOLARSHIP },
  studentsByMobile: new Map([
    ['9876543210', { id: 'stu_new', fullName: 'Asha Kumari', isTestBlocked: false }],
    ['9876543211', { id: 'stu_member', fullName: 'Ravi Teja', isTestBlocked: false }],
    ['9876543212', { id: 'stu_other', fullName: null, isTestBlocked: false }],
    ['9000000000', { id: 'stu_off', fullName: 'Blocked Bhanu', isTestBlocked: true }],
  ]),
  memberIds: new Set(['stu_member']),
});

const plan = (csv: string) => planGroupMemberImport(readCsvTable(csv), context());

describe('planGroupMemberImport', () => {
  it('adds a student who exists and is not in the group', () => {
    const result = plan('Mobile Number\n9876543210');

    assert.equal(result.rows[0]?.action, 'add');
    assert.equal(result.rows[0]?.studentId, 'stu_new');
    assert.equal(result.rows[0]?.studentName, 'Asha Kumari');
    assert.deepEqual(result.summary, { total: 1, willAdd: 1, alreadyMembers: 0, invalid: 0 });
  });

  /**
   * A group is a route to a test, so a roster must not quietly hand one back to an account
   * that is blocked from taking them. A row-level error, not a file-level refusal: the other
   * 199 names in the file are fine and should still go in.
   */
  it('skips a student blocked from tests, and says why', () => {
    const result = plan('Mobile Number\n9000000000');

    assert.equal(result.rows[0]?.action, 'skip');
    assert.match(result.rows[0]?.errors[0] ?? '', /blocked from tests/i);
    assert.equal(result.summary.willAdd, 0);
    assert.equal(result.summary.invalid, 1);
  });

  it('adds the rest of the file around a blocked row', () => {
    const result = plan('Mobile Number\n9000000000\n9876543210');

    assert.equal(result.rows[1]?.action, 'add');
    assert.equal(result.summary.willAdd, 1);
    assert.equal(result.summary.invalid, 1);
  });

  /**
   * Re-uploading last week's list with ten new numbers on the end is how this actually gets used.
   * Calling the existing members errors would bury the ten.
   */
  it('treats an existing member as fine, not as an error', () => {
    const result = plan('Mobile Number\n9876543211');

    assert.equal(result.rows[0]?.action, 'already');
    assert.deepEqual(result.rows[0]?.errors, []);
    assert.equal(result.summary.invalid, 0);
    assert.equal(result.summary.alreadyMembers, 1);
  });

  /**
   * The failure this prevents: a mistyped number silently enrols a person who does not exist, and
   * the group looks one student larger than it is.
   */
  it('reports a number belonging to nobody, and never enrols them', () => {
    const result = plan('Mobile Number\n9999999999');

    assert.equal(result.rows[0]?.action, 'skip');
    assert.equal(result.rows[0]?.studentId, null);
    assert.match(result.rows[0]?.errors[0] ?? '', /import them as a student first/);
  });

  it('skips a number that is not a number at all', () => {
    const result = plan('Mobile Number\nnot-a-number');

    assert.equal(result.rows[0]?.action, 'skip');
    assert.equal(result.rows[0]?.mobile, null);
  });

  it('counts a number listed twice once, and says where the first was', () => {
    const result = plan('Mobile Number\n9876543210\n9876543210');

    assert.equal(result.rows[0]?.action, 'add');
    assert.equal(result.rows[1]?.action, 'skip');
    assert.match(result.rows[1]?.errors[0] ?? '', /Same number as line 2/);
    assert.equal(result.summary.willAdd, 1);
  });

  it('keeps the good rows when one is bad', () => {
    const result = plan('Mobile Number\n9876543210\nrubbish\n9876543211');

    assert.deepEqual(
      result.rows.map((row) => row.action),
      ['add', 'skip', 'already'],
    );
    assert.deepEqual(result.summary, { total: 3, willAdd: 1, alreadyMembers: 1, invalid: 1 });
  });

  it('carries the group so the preview can name what it is adding to', () => {
    assert.deepEqual(plan('Mobile Number\n9876543210').group, {
      id: 'g1',
      name: 'MERIT 2026',
      examType: null,
    });
  });

  it('accepts the other names the column goes by', () => {
    for (const header of ['Mobile Number', 'mobile', 'Phone', 'CONTACT_NUMBER']) {
      const result = plan(`${header}\n9876543210`);
      assert.equal(result.fileErrors.length, 0, header);
      assert.equal(result.rows[0]?.action, 'add');
    }
  });

  it('names the column the sample uses when the header is wrong', () => {
    const result = plan('email\nsomeone@example.com');

    assert.match(result.fileErrors[0] ?? '', /"Mobile Number"/);
    assert.deepEqual(result.rows, []);
  });

  it('says an empty file is empty', () => {
    assert.deepEqual(plan('').fileErrors, ['That file is empty']);
  });

  /**
   * A header row and nothing else is what an admin gets by downloading the sample and uploading it
   * back untouched.
   */
  it('handles a file with a header and no rows', () => {
    const result = plan('Mobile Number');

    assert.deepEqual(result.fileErrors, []);
    assert.deepEqual(result.summary, { total: 0, willAdd: 0, alreadyMembers: 0, invalid: 0 });
  });
});

describe('mobilesInMemberFile', () => {
  it('collects the numbers to look up, under any spelling of the header', () => {
    for (const header of ['Mobile Number', 'phone']) {
      assert.deepEqual(mobilesInMemberFile(readCsvTable(`${header}\n9876543210\n9876543211`)), [
        '9876543210',
        '9876543211',
      ]);
    }
  });

  it('lists a repeated number once', () => {
    assert.deepEqual(mobilesInMemberFile(readCsvTable('Mobile Number\n9876543210\n9876543210')), [
      '9876543210',
    ]);
  });

  it('leaves out anything that could not match a student', () => {
    assert.deepEqual(mobilesInMemberFile(readCsvTable('Mobile Number\nrubbish\n\n9876543210')), [
      '9876543210',
    ]);
  });
});

describe('planGroupMemberImport — a group a sheet cannot grant', () => {
  /**
   * A file-level refusal, not a row error: the group is fixed for the whole upload, so two hundred
   * identical red lines would say the same thing two hundred times and inflate the invalid count.
   */
  it('refuses the whole file for a group reached by an enrolment', () => {
    const result = planGroupMemberImport(readCsvTable('Mobile Number\n9876543210'), {
      ...context(),
      group: { id: 'g2', name: 'SSC CGL MORNING', examType: 'SSC CGL', type: GROUP_TYPE.EXAM },
    });

    assert.deepEqual(result.fileErrors, [DIRECT_GRANT_MESSAGE]);
    assert.deepEqual(result.rows, []);
    assert.equal(result.summary.willAdd, 0);
  });
});
