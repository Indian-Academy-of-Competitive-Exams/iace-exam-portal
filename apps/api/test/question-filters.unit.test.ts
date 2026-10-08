import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { questionListQuerySchema, type QuestionListQuery } from '@iace/contracts';
import { questionWhere } from '../src/questions/question-query';

/** Parsed the way the controller parses it, so the test cannot assume a shape the wire never sends. */
const whereFor = (input: Record<string, unknown>) =>
  questionWhere(questionListQuerySchema.parse(input) as QuestionListQuery);

const conditions = (input: Record<string, unknown>) => {
  const where = whereFor(input);
  return (where.AND ?? []) as Record<string, unknown>[];
};

const conditionFor = (input: Record<string, unknown>, field: string) =>
  conditions(input).find((entry) => field in entry)?.[field];

describe('questionWhere — a filter holding several values', () => {
  it('narrows to any of the subjects chosen', () => {
    assert.deepEqual(conditionFor({ subjectId: 'sub_1,sub_2' }, 'subjectId'), {
      in: ['sub_1', 'sub_2'],
    });
  });

  it('narrows to one the same way, so the query shape never depends on the count', () => {
    assert.deepEqual(conditionFor({ difficulty: 'LOW' }, 'difficulty'), { in: ['LOW'] });
  });

  /** `in: []` matches NOTHING, so an emptied filter has to leave the clause out altogether. */
  it('leaves an emptied filter out rather than matching nothing', () => {
    for (const empty of ['', ',', [] as string[]]) {
      assert.equal(conditionFor({ subjectId: empty }, 'subjectId'), undefined);
    }
  });

  /** Retired questions are out of the bank, so an untouched list is not "everything". */
  it('leaves the archived out when nothing is filtered', () => {
    assert.deepEqual(conditions({}), [{ status: { not: 'ARCHIVED' } }]);
  });

  it('shows them to a reader who asks for them by name', () => {
    assert.deepEqual(conditionFor({ status: 'ARCHIVED' }, 'status'), { in: ['ARCHIVED'] });
  });

  /** The failure this prevents: the ORed status widening past itself, listing the archived to a reader who asked for ACTIVE. */
  it('keeps the archived out when a status other than ARCHIVED is named and any matches', () => {
    assert.deepEqual(conditions({ status: 'ACTIVE', difficulty: 'HIGH', match: 'any' }), [
      { status: { not: 'ARCHIVED' } },
      { OR: [{ difficulty: { in: ['HIGH'] } }, { status: { in: ['ACTIVE'] } }] },
    ]);
  });

  it('still shows them when ARCHIVED is one of the statuses named', () => {
    assert.deepEqual(conditions({ status: 'ACTIVE,ARCHIVED', difficulty: 'HIGH', match: 'any' }), [
      { OR: [{ difficulty: { in: ['HIGH'] } }, { status: { in: ['ACTIVE', 'ARCHIVED'] } }] },
    ]);
  });

  /** The default narrows whichever way the reader is combining filters. */
  it('keeps the archived out even when matching any', () => {
    assert.deepEqual(conditions({ subjectId: 'sub_1', difficulty: 'LOW', match: 'any' }), [
      { status: { not: 'ARCHIVED' } },
      { OR: [{ subjectId: { in: ['sub_1'] } }, { difficulty: { in: ['LOW'] } }] },
    ]);
  });

  it('ANDs the filters, so they narrow together rather than widening', () => {
    const where = conditions({ subjectId: 'sub_1', difficulty: 'LOW,HIGH', status: 'ACTIVE' });

    assert.deepEqual(where, [
      { status: { not: 'ARCHIVED' } },
      { subjectId: { in: ['sub_1'] } },
      { difficulty: { in: ['LOW', 'HIGH'] } },
      { status: { in: ['ACTIVE'] } },
    ]);
  });

  /** Two subjects OR two difficulties is one question; two DIFFERENT filters is another. */
  it('widens across the filters when the reader asks to match any', () => {
    const where = conditions({ subjectId: 'sub_1', difficulty: 'LOW', match: 'any' });

    assert.deepEqual(where, [
      { status: { not: 'ARCHIVED' } },
      { OR: [{ subjectId: { in: ['sub_1'] } }, { difficulty: { in: ['LOW'] } }] },
    ]);
  });

  /** One filter ORed with itself is just that filter, and `OR: []` would match nothing. */
  it('narrows as usual when only one filter is set, whichever mode is asked for', () => {
    assert.deepEqual(conditions({ subjectId: 'sub_1', match: 'any' }), [
      { status: { not: 'ARCHIVED' } },
      { subjectId: { in: ['sub_1'] } },
    ]);
  });

  /** A search says what you are looking for; matching "any" must not list what you did not. */
  it('keeps a search narrowing even when matching any', () => {
    const where = questionWhere(
      questionListQuerySchema.parse({
        q: 'triangle',
        subjectId: 'sub_1',
        difficulty: 'LOW',
        match: 'any',
      }),
    );

    assert.deepEqual(where, {
      AND: [
        { status: { not: 'ARCHIVED' } },
        { searchText: { contains: 'triangle', mode: 'insensitive' } },
        { OR: [{ subjectId: { in: ['sub_1'] } }, { difficulty: { in: ['LOW'] } }] },
      ],
    });
  });

  /** The list bar counts a typed box and a date range as always narrowing, so the server must too. */
  it('keeps a tag, an author and a date range narrowing even when matching any', () => {
    const where = conditions({
      tag: 'mensuration',
      author: 'priya',
      from: '2026-03-01',
      subjectId: 'sub_1',
      difficulty: 'LOW',
      match: 'any',
    });

    assert.deepEqual(
      where.map((entry) => Object.keys(entry)[0]),
      ['status', 'tags', 'createdBy', 'createdAt', 'OR'],
    );
  });

  /** The failure this prevents: the ids coming back on the wire again, and with them the bind ceiling. */
  it('searches with one predicate, never a list of matched ids', () => {
    assert.deepEqual(conditionFor({ q: 'Ram & Shyam' }, 'searchText'), {
      contains: 'Ram & Shyam',
      mode: 'insensitive',
    });
    assert.equal(conditionFor({ q: 'Ram & Shyam' }, 'id'), undefined);
  });
});

describe('questionWhere — who wrote it and when', () => {
  /** There is no picker of authors, so the filter matches what an admin is known by. */
  it('matches the author by name or by the email they sign in with', () => {
    assert.deepEqual(conditionFor({ author: 'priya' }, 'createdBy'), {
      OR: [
        { fullName: { contains: 'priya', mode: 'insensitive' } },
        { email: { contains: 'priya', mode: 'insensitive' } },
      ],
    });
  });

  it('leaves an empty author box out rather than matching the empty string', () => {
    assert.equal(conditionFor({ author: '   ' }, 'createdBy'), undefined);
  });

  /** A day read as an instant starts at 05:30 IST, losing a whole morning of drafts. */
  it('covers the whole institute day at each end of the range', () => {
    const range = conditionFor({ from: '2026-03-01', to: '2026-03-01' }, 'createdAt') as {
      gte: Date;
      lte: Date;
    };

    assert.equal(range.gte.toISOString(), '2026-02-28T18:30:00.000Z');
    assert.equal(range.lte.toISOString(), '2026-03-01T18:29:59.999Z');
  });

  it('takes an open-ended range from either side', () => {
    assert.deepEqual(Object.keys(conditionFor({ from: '2026-03-01' }, 'createdAt') ?? {}), ['gte']);
    assert.deepEqual(Object.keys(conditionFor({ to: '2026-03-01' }, 'createdAt') ?? {}), ['lte']);
  });

  it('adds no date clause when neither end was given', () => {
    assert.equal(conditionFor({}, 'createdAt'), undefined);
  });
});
