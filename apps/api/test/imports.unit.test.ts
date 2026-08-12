import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsv, readCsvTable, normaliseHeader } from '../src/imports/csv';
import { planStudentImport, type ImportContext } from '../src/imports/student-import';

/**
 * A CSV reader that gets a quote or a BOM wrong does not throw — it shifts
 * every column right, and the import succeeds with the wrong data in the wrong
 * fields. Each case below is a real spreadsheet behaviour, which is why they
 * are enumerated rather than assumed.
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
    // Blank lines are dropped, so deriving the number from the row's INDEX
    // reported every row after one a line early. An error pointing at the wrong
    // row is worse than one pointing nowhere: the admin "fixes" a good row.
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
  existingByMobile: new Map([['9000000001', { id: 'stu_existing', fullName: 'Already Here' }]]),
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
      'mobile,fullName\n9876543210,Asha\n9000000001,Renamed',
      context(),
    );

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willUpdate: 1, invalid: 0 });
    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'update');
    assert.equal(plan.rows[1]?.existingStudentId, 'stu_existing');
  });

  it('resolves group names, several to a cell', () => {
    const plan = planStudentImport(
      'mobile,groups\n9876543210,AMEERPET / SSC CGL MORNING;SSC CGL EVENING',
      context(),
    );

    assert.deepEqual(plan.rows[0]?.groupIds, ['g_morning_am', 'g_evening']);
    assert.equal(plan.rows[0]?.action, 'create');
  });

  it('matches a group name however it was typed', () => {
    const plan = planStudentImport('mobile,groups\n9876543210,ssc cgl  Evening', context());
    assert.deepEqual(plan.rows[0]?.groupIds, ['g_evening']);
  });

  it('refuses an unknown group instead of creating one', () => {
    // A typo would otherwise become a real group that grants nothing, and the
    // students in it would quietly see no tests.
    const plan = planStudentImport('mobile,groups\n9876543210,SSC Mornig', context());

    assert.equal(plan.rows[0]?.action, 'skip');
    assert.match(plan.rows[0]?.errors[0] ?? '', /No group called "SSC MORNIG"/);
  });

  /**
   * The failure this prevents: a name that two centres share is resolved by
   * picking the first, and a Kukatpally roster quietly enrols into Ameerpet.
   * Nothing about that looks wrong afterwards.
   */
  it('refuses a name that exists in more than one branch, and names them', () => {
    const plan = planStudentImport('mobile,groups\n9876543210,SSC CGL MORNING', context());

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
    const plan = planStudentImport('mobile,groups\n9876543210,GLOBAL / ALL STUDENTS', context());
    assert.deepEqual(plan.rows[0]?.groupIds, ['g_all']);
  });

  it('reports a qualified name whose branch does not have that group', () => {
    const plan = planStudentImport(
      'mobile,groups\n9876543210,KUKATPALLY / SSC CGL EVENING',
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
      'mobile,fullName\n9876543210,Good\nnot-a-number,Bad\n9876543211,Also good',
      context(),
    );

    assert.deepEqual(plan.summary, { total: 3, willCreate: 2, willUpdate: 0, invalid: 1 });
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.equal(plan.rows[1]?.line, 3);
  });

  it('reports an empty mobile cell differently from an invalid one', () => {
    const plan = planStudentImport('mobile,fullName\n,Asha\nabcdef,Ravi', context());

    assert.match(plan.rows[0]?.errors[0] ?? '', /No mobile number/);
    assert.match(plan.rows[1]?.errors[0] ?? '', /valid 10-digit/);
  });

  it('catches the same number twice in one file, naming the earlier line', () => {
    // Two "creates" for one number would pass preview and then collide on the
    // unique index halfway through the commit.
    const plan = planStudentImport('mobile\n9876543210\n9876543210', context());

    assert.equal(plan.rows[0]?.action, 'create');
    assert.equal(plan.rows[1]?.action, 'skip');
    assert.match(plan.rows[1]?.errors[0] ?? '', /Same number as line 2/);
    assert.equal(plan.summary.willCreate, 1);
  });

  it('treats +91 and spacing as the same number as the bare digits', () => {
    const plan = planStudentImport('mobile\n+91 90000 00001', context());

    assert.equal(plan.rows[0]?.action, 'update');
    assert.equal(plan.rows[0]?.mobile, '9000000001');
  });

  it('reports a missing required column against the FILE, not every row', () => {
    const plan = planStudentImport('name,groups\nAsha,SSC CGL EVENING', context());

    assert.deepEqual(plan.rows, []);
    assert.equal(plan.fileErrors.length, 1);
    assert.match(plan.fileErrors[0] ?? '', /needs a "mobile" column/);
  });

  it('handles an empty upload without throwing', () => {
    const plan = planStudentImport('', context());

    assert.deepEqual(plan.summary, { total: 0, willCreate: 0, willUpdate: 0, invalid: 0 });
    assert.match(plan.fileErrors[0] ?? '', /empty/);
  });

  it('accepts a header-only file as nothing to do, not an error', () => {
    const plan = planStudentImport('mobile,fullName', context());

    assert.equal(plan.summary.total, 0);
    assert.deepEqual(plan.fileErrors, []);
  });

  it('is deterministic — preview and commit run this same function', () => {
    const csv = 'mobile,fullName,groups\n9876543210,Asha,SSC CGL EVENING\nbad,X,';

    assert.deepEqual(planStudentImport(csv, context()), planStudentImport(csv, context()));
  });
});
