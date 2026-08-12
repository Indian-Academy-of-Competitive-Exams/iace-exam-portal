import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STUDENT_SORTS, studentListQuerySchema, type StudentListQuery } from '@iace/contracts';
import { studentOrderBy, studentWhere } from '../src/students/student-query';

/** Parses like a real request would, so the tests exercise the coercions too. */
const query = (params: Record<string, string> = {}): StudentListQuery =>
  studentListQuerySchema.parse(params);

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
      assert.equal(field in studentWhere(query()), false, `${field} must be absent by default`);
      assert.equal(studentWhere(query({ [field]: 'false' }))[field], false);
      assert.equal(studentWhere(query({ [field]: 'true' }))[field], true);
    }
  });

  /**
   * A PIN the institute handed out is not a sign-in. Counting it as one turns
   * "never signed in" — the list of people to chase — into "was never
   * imported", the moment the first roster is uploaded.
   */
  it('reads neverSignedIn as "has no PIN OF THEIR OWN", both ways round', () => {
    assert.deepEqual(studentWhere(query({ neverSignedIn: 'true' })).OR, [
      { pinHash: null },
      { pinIsDefault: true },
    ]);

    const signedIn = studentWhere(query({ neverSignedIn: 'false' }));
    assert.deepEqual(signedIn.pinHash, { not: null });
    assert.equal(signedIn.pinIsDefault, false);
  });

  it('can ask for exactly the students still on a starting PIN', () => {
    assert.equal(studentWhere(query({ hasDefaultPin: 'true' })).pinIsDefault, true);
    assert.equal('pinIsDefault' in studentWhere(query()), false);
  });

  it('asks membership, not a column, for ungrouped', () => {
    assert.deepEqual(studentWhere(query({ ungrouped: 'true' })).groups, { none: {} });
    assert.deepEqual(studentWhere(query({ ungrouped: 'false' })).groups, { some: {} });
  });
});

describe('studentWhere — access-shaped filters', () => {
  it('finds a group through membership', () => {
    assert.deepEqual(studentWhere(query({ groupId: 'g1' })).groups, { some: { id: 'g1' } });
  });

  /**
   * A branch has no students of its own — it has groups, and those have
   * members. Asking the student table for a branchId directly would find none.
   */
  it('finds a branch through the groups under it', () => {
    assert.deepEqual(studentWhere(query({ branchId: 'b1' })).groups, {
      some: { branchId: 'b1' },
    });
  });
});

describe('studentWhere — joined between', () => {
  it('covers the WHOLE of the last day, not up to its midnight', () => {
    const where = studentWhere(query({ joinedFrom: '2026-08-03', joinedTo: '2026-08-03' }));
    const range = where.createdAt as { gte: Date; lte: Date };

    assert.equal(range.gte.toISOString(), '2026-08-03T00:00:00.000Z');
    // Someone who enrolled at 4pm on the 3rd is inside a 3rd-to-3rd range. A
    // midnight bound would return nothing and read as "there are none".
    assert.equal(range.lte.toISOString(), '2026-08-03T23:59:59.999Z');
    assert.ok(new Date('2026-08-03T16:00:00.000Z') <= range.lte);
  });

  it('accepts an open-ended range at either end', () => {
    assert.deepEqual(
      Object.keys(studentWhere(query({ joinedFrom: '2026-01-01' })).createdAt ?? {}),
      ['gte'],
    );
    assert.deepEqual(Object.keys(studentWhere(query({ joinedTo: '2026-01-01' })).createdAt ?? {}), [
      'lte',
    ]);
  });

  it('leaves createdAt alone when no range was given', () => {
    assert.equal('createdAt' in studentWhere(query()), false);
  });
});

describe('studentWhere — filters combine', () => {
  /**
   * Filters that stop being ANDed is the silent version of this screen being
   * wrong: it shows more people than were asked for and looks fine doing it.
   */
  it('applies every filter at once rather than the last one set', () => {
    const where = studentWhere(
      query({
        q: '98765',
        branchId: 'b1',
        isActive: 'true',
        preTestReady: 'false',
        joinedFrom: '2026-01-01',
      }),
    );

    assert.equal(where.isActive, true);
    assert.equal(where.preTestReady, false);
    assert.deepEqual(where.groups, { some: { branchId: 'b1' } });
    assert.ok(where.createdAt);
    assert.equal(where.OR?.length, 2);
  });

  it('searches a mobile number and a name together', () => {
    const or = studentWhere(query({ q: 'ravi' })).OR;
    assert.deepEqual(or, [
      { mobile: { contains: 'ravi' } },
      { fullName: { contains: 'ravi', mode: 'insensitive' } },
    ]);
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
