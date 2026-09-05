import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STUDENT_SORTS, studentListQuerySchema, type StudentListQuery } from '@iace/contracts';
import { studentOrderBy, studentWhere } from '../src/students/student-query';

/** Parses like a real request would, so the tests exercise the coercions too. */
const query = (params: Record<string, string> = {}): StudentListQuery =>
  studentListQuerySchema.parse(params);

/** The conditions a query produced, in no particular order. */
const conditionsFor = (params: Record<string, string> = {}) =>
  (studentWhere(query(params)).AND as Record<string, unknown>[] | undefined) ?? [];

/** Asserts one exact condition is present among them. */
const assertHas = (params: Record<string, string>, condition: unknown) => {
  const conditions = conditionsFor(params);
  const found = conditions.some(
    (candidate) => JSON.stringify(candidate) === JSON.stringify(condition),
  );
  assert.ok(found, `expected ${JSON.stringify(condition)} among ${JSON.stringify(conditions)}`);
};

describe('studentWhere — an absent filter narrows nothing', () => {
  /**
   * The failure this exists to prevent: a filter nobody set still restricts the list, and the roster
   * quietly shows a subset of the students while looking exactly like the whole thing.
   */
  it('is empty when nothing was asked for', () => {
    assert.deepEqual(studentWhere(query()), {});
  });

  it('ignores an empty search box', () => {
    assert.deepEqual(studentWhere(query({ q: '   ' })), {});
  });
});

describe('studentWhere — three-state filters', () => {
  /**
   * `false` is a question, not a default. A control offering any/yes/no must be able to ask for
   * "no", so absent and false cannot collapse into each other.
   */
  it('tells absent apart from false, for every boolean filter', () => {
    for (const field of [
      'isActive',
      'isTestBlocked',
      'preTestReady',
      'profileCompleted',
    ] as const) {
      assert.equal(conditionsFor().length, 0, `${field} must be absent by default`);
      assertHas({ [field]: 'false' }, { [field]: false });
      assertHas({ [field]: 'true' }, { [field]: true });
    }
  });

  /** A PIN the institute handed out is not a sign-in. */
  it('reads neverSignedIn as "has no PIN OF THEIR OWN", both ways round', () => {
    assertHas({ neverSignedIn: 'true' }, { OR: [{ pinHash: null }, { pinIsDefault: true }] });
    assertHas({ neverSignedIn: 'false' }, { pinHash: { not: null }, pinIsDefault: false });
  });

  it('can ask for exactly the students still on a starting PIN', () => {
    assertHas({ hasDefaultPin: 'true' }, { pinIsDefault: true });
    assert.equal(conditionsFor().length, 0);
  });

  /**
   * "Reaches no test" is enrolments AND programs, not one of them. Reading either alone fires on
   * students who are perfectly well placed, which makes the amber badge meaningless.
   */
  it('reads noAccess as "no enrolment AND no program", both ways round', () => {
    assertHas(
      { noAccess: 'true' },
      { enrolledExams: { isEmpty: true }, programs: { isEmpty: true } },
    );
    assertHas(
      { noAccess: 'false' },
      { NOT: { enrolledExams: { isEmpty: true }, programs: { isEmpty: true } } },
    );
  });
});

describe('studentWhere — access-shaped filters', () => {
  /** The branch a student ATTENDS, which is the one access and scheduling read. */
  it('finds a branch as a column on the student, with no join', () => {
    assertHas({ branchId: 'b1' }, { currentBranchId: { in: ['b1'] } });
  });

  it('takes several branches at once — "who do these centres teach"', () => {
    assertHas({ branchId: 'b1,b2' }, { currentBranchId: { in: ['b1', 'b2'] } });
  });

  /** `in: []` matches nothing, so an emptied branch filter must list every student. */
  it('drops the branch filter when it names none', () => {
    assert.deepEqual(conditionsFor({ branchId: '' }), []);
  });

  /** What an import wrote onto the student, and the only way to see who is on a program. */
  it('finds the students on a program', () => {
    assertHas({ programCode: 'FOUNDATION' }, { programs: { hasSome: ['FOUNDATION'] } });
  });

  it('takes several programs at once', () => {
    assertHas(
      { programCode: 'FOUNDATION,CRASH' },
      { programs: { hasSome: ['FOUNDATION', 'CRASH'] } },
    );
  });

  /** The course a STANDARD series reaches them by, so this is the roster behind an offering. */
  it('finds the students enrolled on a course', () => {
    assertHas({ course: 'SSC' }, { enrolledCourses: { hasSome: ['SSC'] } });
  });

  /** An event's roster is a join row, so it reaches the students through EventCandidate. */
  it('finds the candidates on an event', () => {
    assertHas({ eventId: 'evt_1' }, { eventCandidacies: { some: { eventId: { in: ['evt_1'] } } } });
  });

  it('takes several events at once', () => {
    assertHas(
      { eventId: 'evt_1,evt_2' },
      { eventCandidacies: { some: { eventId: { in: ['evt_1', 'evt_2'] } } } },
    );
  });

  /** Set-valued like the rest: naming no event means every student, never none of them. */
  it('drops the event filter when it names none', () => {
    assert.deepEqual(conditionsFor({ eventId: '' }), []);
  });

  /** Both are set-valued: naming none means every student, never none of them. */
  it('drops the program and course filters when they name none', () => {
    assert.deepEqual(conditionsFor({ programCode: '', course: '' }), []);
  });

  /** The enum is checked at the edge, so a typo is a 400 and never a silently empty roster. */
  it('refuses a course that is not one', () => {
    assert.throws(() => query({ course: 'BANKING_TYPO' }));
  });
});

/** Every case here once silently LOST a filter. */
describe('studentWhere — filters COMBINE rather than overwrite each other', () => {
  it('keeps the branch filter when a status is chosen too', () => {
    const params = { branchId: 'b1', isTestBlocked: 'true' };

    assertHas(params, { currentBranchId: { in: ['b1'] } });
    assertHas(params, { isTestBlocked: true });
    assert.equal(conditionsFor(params).length, 2);
  });

  it('keeps the branch filter alongside the access one', () => {
    const params = { branchId: 'b1', noAccess: 'false' };

    assertHas(params, { currentBranchId: { in: ['b1'] } });
    assertHas(params, {
      NOT: { enrolledExams: { isEmpty: true }, programs: { isEmpty: true } },
    });
  });

  /**
   * The likeliest one to be hit: pick "Never signed in", then type a name. The status filter used to
   * disappear and the search ran across everyone.
   */
  it('keeps "never signed in" when a search is typed', () => {
    const params = { neverSignedIn: 'true', q: 'ravi' };

    assertHas(params, { OR: [{ pinHash: null }, { pinIsDefault: true }] });
    assertHas(params, {
      OR: [
        { mobile: { contains: 'ravi' } },
        { fullName: { contains: 'ravi', mode: 'insensitive' } },
      ],
    });
  });

  it('keeps both PIN conditions when asked for contradictory things', () => {
    // Contradictory on purpose: it must return nobody, not quietly pick one.
    const params = { neverSignedIn: 'false', hasDefaultPin: 'true' };

    assertHas(params, { pinHash: { not: null }, pinIsDefault: false });
    assertHas(params, { pinIsDefault: true });
  });

  it('applies every filter at once rather than the last one set', () => {
    const conditions = conditionsFor({
      q: '98765',
      branchId: 'b1',
      isActive: 'true',
      isTestBlocked: 'false',
      preTestReady: 'false',
      neverSignedIn: 'true',
      course: 'SSC',
      programCode: 'FOUNDATION',
    });

    assert.equal(conditions.length, 8, 'every filter must survive');
  });

  it('searches a mobile number and a name together', () => {
    assertHas(
      { q: 'ravi' },
      {
        OR: [
          { mobile: { contains: 'ravi' } },
          { fullName: { contains: 'ravi', mode: 'insensitive' } },
        ],
      },
    );
  });
});

describe('studentOrderBy', () => {
  it('defaults to newest first', () => {
    assert.deepEqual(studentOrderBy(query().sort), [{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  /**
   * Without a tie-break, rows sharing a sort value can come back in a different order per query —
   * which shows one student on two pages and hides another entirely.
   */
  it('always tie-breaks on id, whatever the sort', () => {
    for (const sort of Object.values(STUDENT_SORTS)) {
      const order = studentOrderBy(sort);
      assert.ok('id' in (order.at(-1) ?? {}), `${sort} must tie-break on id`);
    }
  });

  it('puts unnamed students last when sorting by name', () => {
    assert.deepEqual(studentOrderBy(STUDENT_SORTS.NAME)[0], {
      fullName: { sort: 'asc', nulls: 'last' },
    });
  });

  it('refuses a sort the database was never asked to serve', () => {
    assert.equal(studentListQuerySchema.safeParse({ sort: 'pinHash' }).success, false);
  });
});
