import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { questionListQuerySchema, type QuestionListQuery } from '@iace/contracts';
import { questionWhere } from '../src/questions/question-query';

/** Parsed the way the controller parses it, so the test cannot assume a shape the wire never sends. */
const whereFor = (input: Record<string, unknown>) =>
  questionWhere(questionListQuerySchema.parse(input) as QuestionListQuery, null);

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

  it('asks for everything when nothing is filtered', () => {
    assert.deepEqual(whereFor({}), {});
  });

  it('ANDs the filters, so they narrow together rather than widening', () => {
    const where = conditions({ subjectId: 'sub_1', difficulty: 'LOW,HIGH', status: 'ACTIVE' });

    assert.deepEqual(where, [
      { subjectId: { in: ['sub_1'] } },
      { difficulty: { in: ['LOW', 'HIGH'] } },
      { status: { in: ['ACTIVE'] } },
    ]);
  });

  /** Two subjects OR two difficulties is one question; two DIFFERENT filters is another. */
  it('widens across the filters when the reader asks to match any', () => {
    const where = conditions({ subjectId: 'sub_1', difficulty: 'LOW', match: 'any' });

    assert.deepEqual(where, [
      { OR: [{ subjectId: { in: ['sub_1'] } }, { difficulty: { in: ['LOW'] } }] },
    ]);
  });

  /** One filter ORed with itself is just that filter, and `OR: []` would match nothing. */
  it('narrows as usual when only one filter is set, whichever mode is asked for', () => {
    assert.deepEqual(conditions({ subjectId: 'sub_1', match: 'any' }), [
      { subjectId: { in: ['sub_1'] } },
    ]);
  });

  /** A search says what you are looking for; matching "any" must not list what you did not. */
  it('keeps a search narrowing even when matching any', () => {
    const where = questionWhere(
      questionListQuerySchema.parse({ subjectId: 'sub_1', difficulty: 'LOW', match: 'any' }),
      ['q_1'],
    );

    assert.deepEqual(where, {
      AND: [
        { id: { in: ['q_1'] } },
        { OR: [{ subjectId: { in: ['sub_1'] } }, { difficulty: { in: ['LOW'] } }] },
      ],
    });
  });

  /** The search runs as its own query; no result must still match nothing, not everything. */
  it('keeps an empty search result matching nothing', () => {
    const where = questionWhere(questionListQuerySchema.parse({}) as QuestionListQuery, []);

    assert.deepEqual(where, { AND: [{ id: { in: [] } }] });
  });
});
