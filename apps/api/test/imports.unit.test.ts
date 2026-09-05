import assert from 'node:assert/strict';
import { BRANCH_TYPE, IMPORT_MAX_ROWS } from '@iace/contracts';
import { describe, it } from 'node:test';
import { parseCsv, readCsvTable, normaliseHeader } from '../src/common/importing';
import { mobilesIn, planStudentImport, type ImportContext } from '../src/imports/student-import';
import { roster } from './support/fakes';

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

const context = (over: Partial<ImportContext> = {}): ImportContext => ({
  existingByMobile: new Map([
    // Chose their own PIN already — an import must never reset it.
    [
      '9000000001',
      {
        id: 'stu_existing',
        fullName: 'Already Here',
        hasPin: true,
        currentBranchId: 'br_ameerpet',
      },
    ],
    // Added by an admin and never signed in: this one still needs a starting PIN.
    [
      '9000000002',
      { id: 'stu_no_pin', fullName: null, hasPin: false, currentBranchId: 'br_ameerpet' },
    ],
  ]),
  branchByName: new Map([
    ['AMEERPET', { id: 'br_ameerpet', type: BRANCH_TYPE.PHYSICAL }],
    ['ONLINE', { id: 'br_online', type: BRANCH_TYPE.VIRTUAL }],
  ]),
  examCodes: new Set(['SSC CGL', 'RRB JE']),
  programCodes: new Set(['SSC FOUNDATION']),
  ...over,
});

describe('planStudentImport', () => {
  it('plans a create for a new number and an update for a known one', () => {
    const plan = planStudentImport(
      readCsvTable(roster('mobile,fullName\n9876543210,Asha\n9000000001,Renamed')),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willUpdate: 1, invalid: 0 });
    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'update');
    assert.equal(plan.rows[1]?.existingStudentId, 'stu_existing');
  });

  it('skips a bad row and keeps the rest of the file', () => {
    // The whole point of "forgiving": one bad number must not cost the other
    // two rows.
    const plan = planStudentImport(
      readCsvTable(
        roster('mobile,fullName\n9876543210,Good\nnot-a-number,Bad\n9876543211,Also good'),
      ),
      context(),
    );

    assert.deepEqual(plan.summary, { total: 3, willCreate: 2, willUpdate: 0, invalid: 1 });
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.equal(plan.rows[1]?.line, 3);
  });

  it('reports an empty mobile cell differently from an invalid one', () => {
    const plan = planStudentImport(
      readCsvTable(roster('mobile,fullName\n,Asha\nabcdef,Ravi')),
      context(),
    );

    assert.match(plan.rows[0]?.errors[0] ?? '', /No mobile number/);
    assert.match(plan.rows[1]?.errors[0] ?? '', /valid 10-digit/);
  });

  it('catches the same number twice in one file, naming the earlier line', () => {
    // Two "creates" for one number would pass preview and then collide on the
    // unique index halfway through the commit.
    const plan = planStudentImport(
      readCsvTable(roster('mobile\n9876543210\n9876543210')),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.match(plan.rows[1]?.errors[0] ?? '', /Same number as line 2/);
    assert.equal(plan.summary.willCreate, 1);
  });

  it('treats +91 and spacing as the same number as the bare digits', () => {
    const plan = planStudentImport(readCsvTable(roster('mobile\n+91 90000 00001')), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.mobile, '9000000001');
  });

  it('reports a missing required column against the FILE, not every row', () => {
    const plan = planStudentImport(readCsvTable('name,city\nAsha,Hyderabad'), context());

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
    const plan = planStudentImport(readCsvTable(roster('mobile,fullName')), context());

    assert.equal(plan.summary.total, 0);
    assert.deepEqual(plan.fileErrors, []);
  });

  it('is deterministic — preview and commit run this same function', () => {
    const csv = 'mobile,fullName\n9876543210,Asha\nbad,X';

    assert.deepEqual(
      planStudentImport(readCsvTable(csv), context()),
      planStudentImport(readCsvTable(csv), context()),
    );
  });
});

describe('planStudentImport — the starting PIN', () => {
  it('gives a new student one', () => {
    const plan = planStudentImport(readCsvTable(roster('mobile\n9876543210')), context());

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, true);
  });

  /**
   * The failure this exists to prevent: re-importing last term's roster resets the PIN of every
   * student who had chosen one, handing all of those accounts back to whoever holds the sheet — and
   * nothing about the import looks wrong.
   */
  it('never resets a PIN the student chose', () => {
    const plan = planStudentImport(readCsvTable(roster('mobile\n9000000001')), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, false);
  });

  it('gives one to a student who was added by hand and never set a PIN', () => {
    const plan = planStudentImport(readCsvTable(roster('mobile\n9000000002')), context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, true);
  });

  it('gives none to a row that will not be written at all', () => {
    const plan = planStudentImport(readCsvTable(roster('mobile\nnot-a-number')), context());

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.equal(plan.rows[0]?.willReceiveDefaultPin, false);
  });
});

describe('the columns an admin actually writes', () => {
  it('reads the readable headers the sample file uses', () => {
    const plan = planStudentImport(
      readCsvTable(roster('Mobile Number,Full Name\n9876543210,Asha Kumari')),
      context(),
    );

    assert.equal(plan.fileErrors.length, 0);
    assert.equal(plan.rows[0]?.mobile, '9876543210');
    assert.equal(plan.rows[0]?.fullName, 'Asha Kumari');
  });

  /**
   * Every one of these is a real file somebody will try: last month's template, a roster exported
   * from another system, a sheet typed by hand.
   */
  it('accepts the other names the same column goes by', () => {
    for (const header of ['mobile', 'Phone', 'Contact Number', 'MOBILE_NO']) {
      const plan = planStudentImport(readCsvTable(roster(`${header}\n9876543210`)), context());
      assert.equal(plan.fileErrors.length, 0, `"${header}" should be understood`);
      assert.equal(plan.rows[0]?.mobile, '9876543210');
    }
  });

  /** A required column must be PRESENT; whether its cell may be blank is a separate rule. */
  const ALL_HEADERS =
    "Mobile Number,Student Type,Branch Name,Enrolled Courses,Enrolled Exams,Programs,Mother's Name,Date of Birth,Gender";

  const sheet = (...cells: string[]) => `${ALL_HEADERS}\n${cells.join(',')}`;

  /** The whole point of the wider template: a roster now decides what a student can reach. */
  it('carries the access columns onto the row it plans', () => {
    const plan = planStudentImport(
      readCsvTable(
        sheet('9876543210', 'OFFLINE', 'Ameerpet', 'SSC', '"SSC CGL, RRB JE"', 'SSC FOUNDATION'),
      ),
      context(),
    );

    const row = plan.rows[0];
    assert.deepEqual(row?.errors, []);
    assert.equal(row?.studentType, 'OFFLINE');
    assert.equal(row?.currentBranchId, 'br_ameerpet');
    assert.deepEqual(row?.enrolledCourses, ['SSC']);
    assert.deepEqual(row?.enrolledExams, ['SSC CGL', 'RRB JE']);
    assert.deepEqual(row?.programs, ['SSC FOUNDATION']);
  });

  /** The sheet carries the branch NAME; nobody filling one in has a cuid to hand. */
  it('resolves the branch by name, however it was cased or spaced', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'OFFLINE', '  ameerpet  ', '', 'SSC CGL', '')),
      context(),
    );

    assert.deepEqual(plan.rows[0]?.errors, []);
    assert.equal(plan.rows[0]?.currentBranchId, 'br_ameerpet');
  });

  it('refuses a branch that is not on the list, naming what it read', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'OFFLINE', 'Nowhere', '', 'SSC CGL', '')),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors.join(' ') ?? '', /no active branch called "NOWHERE"/);
  });

  /** Demanding all three would refuse a student on one exam and in no program. */
  it('takes a row carrying only one of the three access routes', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'OFFLINE', 'AMEERPET', '', 'SSC CGL', '')),
      context(),
    );

    assert.deepEqual(plan.rows[0]?.errors, []);
    assert.equal(plan.rows[0]?.action, 'create');
  });

  it('refuses a row that names none of them, because it reaches nothing', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'OFFLINE', 'AMEERPET', '', '', '')),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors.join(' ') ?? '', /reaches no test series/);
  });

  it('refuses an exam code and a program code the catalog does not hold', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'OFFLINE', 'AMEERPET', '', 'SSC CGI', 'MADE UP')),
      context(),
    );

    const errors = plan.rows[0]?.errors.join(' ') ?? '';
    assert.match(errors, /No such exam code: SSC CGI/);
    assert.match(errors, /No such program code: MADE UP/);
  });

  /** The same pairing the admin screens refuse — the importer writes rows no screen could save. */
  it('refuses an online student put at a physical centre', () => {
    const plan = planStudentImport(
      readCsvTable(sheet('9876543210', 'ONLINE', 'AMEERPET', '', 'SSC CGL', '')),
      context(),
    );

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors.join(' ') ?? '', /online student sits in the online branch/);
  });

  it('reads the profile columns, taking a date written either way round', () => {
    const plan = planStudentImport(
      readCsvTable(
        sheet(
          '9876543210',
          'OFFLINE',
          'AMEERPET',
          '',
          'SSC CGL',
          '',
          'Lakshmi Kumari',
          '11/04/2003',
          'female',
        ),
      ),
      context(),
    );

    assert.deepEqual(plan.rows[0]?.errors, []);
    assert.equal(plan.rows[0]?.profile.motherName, 'Lakshmi Kumari');
    assert.equal(plan.rows[0]?.profile.dob, '2003-04-11');
    assert.equal(plan.rows[0]?.profile.gender, 'FEMALE');
  });

  it('names the column the way the sample file does when it is missing', () => {
    const plan = planStudentImport(readCsvTable('name,city\nAsha,X'), context());

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
});

/** Every NEW student is given a starting PIN, and argon2 costs ~13ms a hash by design. */
describe('how big a file may be', () => {
  const fileOf = (rows: number) =>
    roster(
      [
        'Mobile Number',
        ...Array.from({ length: rows }, (_, i) => `98765${String(i).padStart(5, '0')}`),
      ].join('\n'),
    );

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
