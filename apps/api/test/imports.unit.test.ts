import assert from 'node:assert/strict';
import { IMPORT_MAX_ROWS } from '@iace/contracts';
import { describe, it } from 'node:test';
import { parseCsv, readCsvTable, normaliseHeader } from '../src/imports/csv';
import {
  groupEntriesIn,
  mobilesIn,
  planStudentImport,
  type ImportContext,
} from '../src/imports/student-import';

/**
 * A CSV reader that gets a quote or a BOM wrong does not throw — it shifts every column right, and
 * the import succeeds with the wrong data in the wrong fields.
 */

describe('parseCsv', () => {
  it('reads a plain sheet', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('survives the BOM Excel writes in front of UTF-8 files', () => {
    // Left in place it becomes part of the first header, and "mobile" matches
    // nothing — the whole file then reports a missing column.
    const [header] = parseCsv('\uFEFFmobile,fullName\n9876543210,Asha');
    assert.deepEqual(header, ['mobile', 'fullName']);
  });

  it('handles CRLF without inventing empty rows', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma that is inside a quoted field', () => {
    // The single most damaging failure: "Kumari, Asha" splitting into two cells
    // pushes every later column one to the right, silently.
    assert.deepEqual(parseCsv('name,city\n"Kumari, Asha",Hyderabad'), [
      ['name', 'city'],
      ['Kumari, Asha', 'Hyderabad'],
    ]);
  });

  it('reads a doubled quote as one literal quote', () => {
    assert.deepEqual(parseCsv('name\n"She said ""hi"""'), [['name'], ['She said "hi"']]);
  });

  it('keeps a newline inside a quoted field', () => {
    assert.deepEqual(parseCsv('a,b\n"line one\nline two",x'), [
      ['a', 'b'],
      ['line one\nline two', 'x'],
    ]);
  });

  it('drops blank lines rather than returning empty rows', () => {
    assert.deepEqual(parseCsv('a\n\n1\n\n'), [['a'], ['1']]);
  });

  it('keeps empty cells, which are not the same as a blank line', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,,3'), [
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('readCsvTable', () => {
  it('matches headers regardless of case, spaces or underscores', () => {
    assert.equal(normaliseHeader('  Full Name '), 'fullname');
    assert.equal(normaliseHeader('FULL_NAME'), 'fullname');

    const table = readCsvTable('Mobile, Full Name\n9876543210, Asha');
    assert.deepEqual(table.rows[0]?.values, { mobile: '9876543210', fullname: 'Asha' });
  });

  it('numbers lines the way an editor does, header included', () => {
    // "line 3" has to mean the third line of their file, or it is not useful
    // against a 400-row sheet.
    const table = readCsvTable('mobile\n9876543210\n9876543211');
    assert.deepEqual(
      table.rows.map((r) => r.line),
      [2, 3],
    );
  });

  it('does not shift line numbers after a blank line — the regression', () => {
    // Blank lines are dropped, so deriving the number from the row's INDEX reported every row after
    // one a line early.
    const table = readCsvTable('mobile\n9876543210\n\n9876543211\n\n\n9876543212');

    assert.deepEqual(
      table.rows.map((r) => r.line),
      [2, 4, 7],
    );
  });

  it('counts the lines a quoted field spans', () => {
    const table = readCsvTable('mobile,note\n9876543210,"one\ntwo"\n9876543211,x');

    assert.deepEqual(
      table.rows.map((r) => r.line),
      [2, 4],
    );
  });
});

// ---------------------------------------------------------------------------

const context = (): ImportContext => ({
  existingByMobile: new Map([
    // Chose their own PIN already — an import must never reset it.
    ['9000000001', { id: 'stu_existing', fullName: 'Already Here', hasPin: true, isActive: true }],
    // Added by an admin and never signed in: this one still needs a starting PIN.
    ['9000000002', { id: 'stu_no_pin', fullName: null, hasPin: false, isActive: true }],
    // Deactivated: a roster must not hand this account a group back.
    ['9000000003', { id: 'stu_off', fullName: 'Gone Away', hasPin: true, isActive: false }],
  ]),
  // Names are canonical in the database, and a name can belong to several
  // branches — "SSC CGL MORNING" runs at two centres here on purpose.
  groupsByName: new Map([
    [
      'SSC CGL MORNING',
      [
        { id: 'g_morning_am', name: 'SSC CGL MORNING', branchName: 'AMEERPET' },
        { id: 'g_morning_kp', name: 'SSC CGL MORNING', branchName: 'KUKATPALLY' },
      ],
    ],
    ['SSC CGL EVENING', [{ id: 'g_evening', name: 'SSC CGL EVENING', branchName: 'AMEERPET' }]],
    ['ALL STUDENTS', [{ id: 'g_all', name: 'ALL STUDENTS', branchName: 'GLOBAL' }]],
  ]),
});

describe('planStudentImport', () => {
  it('plans a create for a new number and an update for a known one', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,fullName\n9876543210,Asha\n9000000001,Renamed'),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willUpdate: 1, invalid: 0 });
    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'update');
    assert.equal(plan.rows[1]?.existingStudentId, 'stu_existing');
  });

  /**
   * The student importer also grants groups, so it is a way back in for a deactivated
   * account. Row-level, so the rest of the roster still imports.
   */
  it('refuses to put a deactivated student into a group', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9000000003,SSC CGL EVENING'),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors[0] ?? '', /deactivated/i);
  });

  /** Their record is still editable — the rule is about gaining a group, not about the row. */
  it('leaves a deactivated student alone when the row names no group', () => {
    const plan = planStudentImport(readCsvTable('mobile,fullName\n9000000003,New Name'), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.deepEqual(plan.rows[0]?.errors, []);
  });

  it('resolves group names, several to a cell', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9876543210,AMEERPET / SSC CGL MORNING;SSC CGL EVENING'),
      context(),
    );

    assert.deepEqual(plan.rows[0]?.groupIds, ['g_morning_am', 'g_evening']);
    assert.equal(plan.rows[0]?.action, 'create');
  });

  it('matches a group name however it was typed', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9876543210,ssc cgl  Evening'),
      context(),
    );
    assert.deepEqual(plan.rows[0]?.groupIds, ['g_evening']);
  });

  it('refuses an unknown group instead of creating one', () => {
    // A typo would otherwise become a real group that grants nothing, and the
    // students in it would quietly see no tests.
    const plan = planStudentImport(readCsvTable('mobile,groups\n9876543210,SSC Mornig'), context());

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors[0] ?? '', /No group called "SSC MORNIG"/);
  });

  /**
   * The failure this prevents: a name that two centres share is resolved by picking the first, and a
   * Kukatpally roster quietly enrols into Ameerpet. Nothing about that looks wrong afterwards.
   */
  it('refuses a name that exists in more than one branch, and names them', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9876543210,SSC CGL MORNING'),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.deepEqual(plan.rows[0]?.groupIds, []);
    const error = plan.rows[0]?.errors[0] ?? '';
    assert.match(error, /more than one branch/);
    assert.match(error, /AMEERPET/);
    assert.match(error, /KUKATPALLY/);
    // and it shows the form that would have worked
    assert.match(error, /AMEERPET \/ SSC CGL MORNING/);
  });

  it('accepts the qualified form for a name that is not ambiguous at all', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9876543210,GLOBAL / ALL STUDENTS'),
      context(),
    );
    assert.deepEqual(plan.rows[0]?.groupIds, ['g_all']);
  });

  it('reports a qualified name whose branch does not have that group', () => {
    const plan = planStudentImport(
      readCsvTable('mobile,groups\n9876543210,KUKATPALLY / SSC CGL EVENING'),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(
      plan.rows[0]?.errors[0] ?? '',
      /No group called "SSC CGL EVENING" in branch "KUKATPALLY"/,
    );
  });

  it('skips a bad row and keeps the rest of the file', () => {
    // The whole point of "forgiving": one bad number must not cost the other
    // two rows.
    const plan = planStudentImport(
      readCsvTable('mobile,fullName\n9876543210,Good\nnot-a-number,Bad\n9876543211,Also good'),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 3, willCreate: 2, willUpdate: 0, invalid: 1 });
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.equal(plan.rows[1]?.line, 3);
  });

  it('reports an empty mobile cell differently from an invalid one', () => {
    const plan = planStudentImport(readCsvTable('mobile,fullName\n,Asha\nabcdef,Ravi'), context());

    assert.match(plan.rows[0]?.errors[0] ?? '', /No mobile number/);
    assert.match(plan.rows[1]?.errors[0] ?? '', /valid 10-digit/);
  });

  it('catches the same number twice in one file, naming the earlier line', () => {
    // Two "creates" for one number would pass preview and then collide on the
    // unique index halfway through the commit.
    const plan = planStudentImport(readCsvTable('mobile\n9876543210\n9876543210'), context());

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.match(plan.rows[1]?.errors[0] ?? '', /Same number as line 2/);
    assert.equal(plan.summary.willCreate, 1);
  });

  it('treats +91 and spacing as the same number as the bare digits', () => {
    const plan = planStudentImport(readCsvTable('mobile\n+91 90000 00001'), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.mobile, '9000000001');
  });

  it('reports a missing required column against the FILE, not every row', () => {
    const plan = planStudentImport(readCsvTable('name,groups\nAsha,SSC CGL EVENING'), context());

    assert.deepEqual(plan.rows, []);
    assert.equal(plan.fileErrors.length, 1);
    assert.match(plan.fileErrors[0] ?? '', /"Mobile Number"/);
  });

  it('handles an empty upload without throwing', () => {
    const plan = planStudentImport(readCsvTable(''), context());

    assert.deepEqual(plan.summary, { total: 0, willCreate: 0, willUpdate: 0, invalid: 0 });
    assert.match(plan.fileErrors[0] ?? '', /empty/);
  });

  it('accepts a header-only file as nothing to do, not an error', () => {
    const plan = planStudentImport(readCsvTable('mobile,fullName'), context());

    assert.equal(plan.summary.total, 0);
    assert.deepEqual(plan.fileErrors, []);
  });

  it('is deterministic — preview and commit run this same function', () => {
    const csv = 'mobile,fullName,groups\n9876543210,Asha,SSC CGL EVENING\nbad,X,';

    assert.deepEqual(
      planStudentImport(readCsvTable(csv), context()),
      planStudentImport(readCsvTable(csv), context()),
    );
  });
});

describe('planStudentImport — the starting PIN', () => {
  it('gives a new student one', () => {
    const plan = planStudentImport(readCsvTable('mobile\n9876543210'), context());

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, true);
  });

  /**
   * The failure this exists to prevent: re-importing last term's roster resets the PIN of every
   * student who had chosen one, handing all of those accounts back to whoever holds the sheet — and
   * nothing about the import looks wrong.
   */
  it('never resets a PIN the student chose', () => {
    const plan = planStudentImport(readCsvTable('mobile\n9000000001'), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, false);
  });

  it('gives one to a student who was added by hand and never set a PIN', () => {
    const plan = planStudentImport(readCsvTable('mobile\n9000000002'), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, true);
  });

  it('gives none to a row that will not be written at all', () => {
    const plan = planStudentImport(readCsvTable('mobile\nnot-a-number'), context());

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, false);
  });
});

describe('the columns an admin actually writes', () => {
  it('reads the readable headers the sample file uses', () => {
    const plan = planStudentImport(
      readCsvTable('Mobile Number,Full Name,Groups\n9876543210,Asha Kumari,SSC CGL EVENING'),
      context(),
    );

    assert.equal(plan.fileErrors.length, 0);
    assert.equal(plan.rows[0]?.mobile, '9876543210');
    assert.equal(plan.rows[0]?.fullName, 'Asha Kumari');
    assert.deepEqual(plan.rows[0]?.groupIds, ['g_evening']);
  });

  /**
   * Every one of these is a real file somebody will try: last month's template, a roster exported
   * from another system, a sheet typed by hand.
   */
  it('accepts the other names the same column goes by', () => {
    for (const header of ['mobile', 'Phone', 'Contact Number', 'MOBILE_NO']) {
      const plan = planStudentImport(readCsvTable(`${header}\n9876543210`), context());
      assert.equal(plan.fileErrors.length, 0, `"${header}" should be understood`);
      assert.equal(plan.rows[0]?.mobile, '9876543210');
    }
  });

  it('names the column the way the sample file does when it is missing', () => {
    const plan = planStudentImport(readCsvTable('name,groups\nAsha,X'), context());

    assert.match(plan.fileErrors[0] ?? '', /"Mobile Number"/);
    assert.match(plan.fileErrors[0] ?? '', /sample file/);
  });
});

/**
 * These build the lookups the import runs before planning anything. They read the file through the
 * SAME column resolution the planner uses — and once did not, which is the bug below.
 */
describe('what the import looks up before it plans', () => {
  it('collects the mobile numbers under the readable header', () => {
    const table = readCsvTable('Mobile Number,Full Name\n9876543210,Asha\n9000000001,Existing');

    assert.deepEqual(mobilesIn(table), ['9876543210', '9000000001']);
  });

  /**
   * The failure this exists to prevent, found by re-importing a file rather than by any unit test:
   * reading the raw `mobile` key while the sheet said "Mobile Number" matched nothing, so every row
   * of a RE-import looked new.
   */
  it('finds them under every spelling of the column', () => {
    for (const header of ['Mobile Number', 'mobile', 'Phone', 'CONTACT_NUMBER']) {
      assert.deepEqual(mobilesIn(readCsvTable(`${header}\n9876543210`)), ['9876543210'], header);
    }
  });

  it('ignores rows whose number could never match a student', () => {
    assert.deepEqual(mobilesIn(readCsvTable('Mobile Number\nnot-a-number\n\n9876543210')), [
      '9876543210',
    ]);
  });

  it('collects group entries under the readable header, several to a cell', () => {
    const table = readCsvTable('Mobile Number,Groups\n9876543210,A / B;C');

    assert.deepEqual(groupEntriesIn(table), ['A / B', 'C']);
  });
});

/** Every NEW student is given a starting PIN, and argon2 costs ~13ms a hash by design. */
describe('how big a file may be', () => {
  const fileOf = (rows: number) =>
    [
      'Mobile Number',
      ...Array.from({ length: rows }, (_, i) => `98765${String(i).padStart(5, '0')}`),
    ].join('\n');

  it('accepts a file at the limit', () => {
    const plan = planStudentImport(readCsvTable(fileOf(IMPORT_MAX_ROWS)), context());

    assert.deepEqual(plan.fileErrors, []);
    assert.equal(plan.summary.total, IMPORT_MAX_ROWS);
  });

  it('refuses one over it, before planning anything', () => {
    const plan = planStudentImport(readCsvTable(fileOf(IMPORT_MAX_ROWS + 1)), context());

    assert.deepEqual(plan.rows, [], 'nothing should be planned');
    assert.match(plan.fileErrors[0] ?? '', new RegExp(`${IMPORT_MAX_ROWS + 1} rows`));
    assert.match(plan.fileErrors[0] ?? '', /split it/);
  });
});
