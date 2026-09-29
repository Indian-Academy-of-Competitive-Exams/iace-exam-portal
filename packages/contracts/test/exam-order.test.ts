import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayOrder, seededRandom, servedQuestions, shuffle } from '../src/exam-order';
import { type ExamQuestion } from '../src/attempts';

const SEED = 987_654;

const rich = (text: string) => [{ type: 'TEXT' as const, text }];

const option = (id: string) => ({ id, position: 1, text: { en: rich(id) } });

const question = (id: string, section: string): ExamQuestion => ({
  questionId: id,
  order: 0,
  baseConfigSectionId: section,
  type: 'SINGLE_MCQ',
  marks: 2,
  negativeMarks: 0.5,
  content: { en: { stem: rich(id) } },
  options: ['a', 'b', 'c', 'd'].map((suffix) => option(`${id}_${suffix}`)),
});

/** Two sections so the within-section rule has something to break. */
const paper = (): ExamQuestion[] => [
  ...['q1', 'q2', 'q3'].map((id) => question(id, 's1')),
  ...['q4', 'q5', 'q6'].map((id) => question(id, 's2')),
];

const ids = (rows: readonly ExamQuestion[]) => rows.map((row) => row.questionId);

describe('the order a sitting sees', () => {
  /** The whole reason this lives in contracts: the server and the browser must agree exactly. */
  it('is identical every time from the same seed', () => {
    const once = servedQuestions(paper(), SEED, true, true);
    const again = servedQuestions(paper(), SEED, true, true);

    assert.deepEqual(ids(once), ids(again));
    assert.deepEqual(
      once.map((row) => row.options.map((o) => o.id)),
      again.map((row) => row.options.map((o) => o.id)),
    );
  });

  it('differs on a different seed, or it is not shuffling at all', () => {
    assert.notDeepEqual(
      ids(servedQuestions(paper(), SEED, true, false)),
      ids(servedQuestions(paper(), SEED + 1, true, false)),
    );
  });

  /** The bug this prevents: a question from section two appearing among section one's. */
  it('never moves a question out of its own section', () => {
    const sections = servedQuestions(paper(), SEED, true, false).map(
      (row) => row.baseConfigSectionId,
    );

    assert.deepEqual(sections, ['s1', 's1', 's1', 's2', 's2', 's2']);
  });

  it('numbers the questions by where they landed, not where they came from', () => {
    assert.deepEqual(
      servedQuestions(paper(), SEED, true, false).map((row) => row.order),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it('leaves both orders alone when neither is shuffled', () => {
    const served = servedQuestions(paper(), SEED, false, false);

    assert.deepEqual(ids(served), ids(paper()));
    assert.deepEqual(
      served[0]?.options.map((o) => o.id),
      paper()[0]?.options.map((o) => o.id),
    );
  });

  /** An unshuffled question order must not consume the generator the options draw from. */
  it('shuffles options the same way whether or not the questions moved', () => {
    const still = servedQuestions(paper(), SEED, false, true);
    const moved = servedQuestions(paper(), SEED, true, true);
    const firstOf = (rows: readonly ExamQuestion[], id: string) =>
      rows.find((row) => row.questionId === id)?.options.map((o) => o.id);

    assert.notDeepEqual(firstOf(still, 'q1'), firstOf(moved, 'q1'));
  });
});

describe('the primitives underneath', () => {
  it('draws the same sequence from the same seed', () => {
    const a = seededRandom(SEED);
    const b = seededRandom(SEED);

    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  it('keeps every item it was given, losing and inventing none', () => {
    const items = Array.from({ length: 50 }, (_, at) => at);

    assert.deepEqual(
      [...shuffle(items, seededRandom(SEED))].sort((x, y) => x - y),
      items,
    );
  });

  it('holds a single-section paper in place when nothing is shuffled', () => {
    assert.deepEqual(displayOrder(paper(), SEED, false), paper());
  });
});
