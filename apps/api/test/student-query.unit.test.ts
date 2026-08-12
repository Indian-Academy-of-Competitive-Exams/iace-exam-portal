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
   * The failure this exists to prevent: a filter nobody set still restricts the
   * list, and the roster quietly shows a subset of the students while looking
   * exactly like the whole thing.
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
   * `false` is a question, not a default. A control offering any/yes/no must be
   * able to ask for "no", so absent and false cannot collapse into each other.
   */
  it('tells absent apart from false, for every boolean filter', () => {
    for (const field of ['isActive', 'preTestReady', 'profileCompleted'] as const) {
      assert.equal(conditionsFor().length, 0, `${field} must be absent by default`);
      assertHas({ [field]: 'false' }, { [field]: false });
      assertHas({ [field]: 'true' }, { [field]: true });
    }
  });

  /**
   * A PIN the institute handed out is not a sign-in. Counting it as one turns
   * "never signed in" — the list of people to chase — into "was never
   * imported", the moment the first roster is uploaded.
   */
  it('reads neverSignedIn as "has no PIN OF THEIR OWN", both ways round', () => {
    assertHas({ neverSignedIn: 'true' }, { OR: [{ pinHash: null }, { pinIsDefault: true }] });
    assertHas({ neverSignedIn: 'false' }, { pinHash: { not: null }, pinIsDefault: false });
  });

  it('can ask for exactly the students still on a starting PIN', () => {
    assertHas({ hasDefaultPin: 'true' }, { pinIsDefault: true });
    assert.equal(conditionsFor().length, 0);
  });

  it('asks membership, not a column, for ungrouped', () => {
    assertHas({ ungrouped: 'true' }, { groups: { none: {} } });
    assertHas({ ungrouped: 'false' }, { groups: { some: {} } });
  });
});

describe('studentWhere — access-shaped filters', () => {
  it('finds a group through membership', () => {
    assertHas({ groupId: 'g1' }, { groups: { some: { id: 'g1' } } });
  });

  /**
   * A branch has no students of its own — it has groups, and those have
   * members. Asking the student table for a branchId directly would find none.
   */
  it('finds a branch through the groups under it', () => {
    assertHas({ branchId: 'b1' }, { groups: { some: { branchId: 'b1' } } });
  });
});

describe('studentWhere — joined between', () => {
  it('covers the WHOLE of the last day, not up to its midnight', () => {
    const [condition] = conditionsFor({ joinedFrom: '2026-08-03', joinedTo: '2026-08-03' });
    const range = (condition as { createdAt: { gte: Date; lte: Date } }).createdAt;

    assert.equal(range.gte.toISOString(), '2026-08-03T00:00:00.000Z');
    // Someone who enrolled at 4pm on the 3rd is inside a 3rd-to-3rd range. A
    // midnight bound would return nothing and read as "there are none".
    assert.equal(range.lte.toISOString(), '2026-08-03T23:59:59.999Z');
    assert.ok(new Date('2026-08-03T16:00:00.000Z') <= range.lte);
  });

  it('accepts an open-ended range at either end', () => {
    const from = conditionsFor({ joinedFrom: '2026-01-01' })[0] as { createdAt: object };
    const to = conditionsFor({ joinedTo: '2026-01-01' })[0] as { createdAt: object };

    assert.deepEqual(Object.keys(from.createdAt), ['gte']);
    assert.deepEqual(Object.keys(to.createdAt), ['lte']);
  });

  it('leaves createdAt alone when no range was given', () => {
    assert.equal(conditionsFor().length, 0);
  });
});

/**
 * Every case here once silently LOST a filter. Three conditions describe
 * `groups` and two describe `OR`; merged into one object, the last spread won
 * and the earlier filter vanished without a trace — the roster showed more
 * people than were asked for and looked completely normal doing it.
 */
describe('studentWhere — filters COMBINE rather than overwrite each other', () => {
  it('keeps the group filter when a branch is chosen too', () => {
    const params = { groupId: 'g1', branchId: 'b1' };

    assertHas(params, { groups: { some: { id: 'g1' } } });
    assertHas(params, { groups: { some: { branchId: 'b1' } } });
    assert.equal(conditionsFor(params).length, 2);
  });

  it('keeps the group filter alongside the ungrouped one', () => {
    assertHas({ groupId: 'g1', ungrouped: 'false' }, { groups: { some: { id: 'g1' } } });
    assertHas({ groupId: 'g1', ungrouped: 'false' }, { groups: { some: {} } });
  });

  /**
   * The likeliest one to be hit: pick "Never signed in", then type a name. The
   * status filter used to disappear and the search ran across everyone.
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
      groupId: 'g1',
      branchId: 'b1',
      isActive: 'true',
      preTestReady: 'false',
      neverSignedIn: 'true',
      joinedFrom: '2026-01-01',
    });

    assert.equal(conditions.length, 7, 'every filter must survive');
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
   * Without a tie-break, rows sharing a sort value can come back in a different
   * order per query — which shows one student on two pages and hides another
   * entirely.
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
