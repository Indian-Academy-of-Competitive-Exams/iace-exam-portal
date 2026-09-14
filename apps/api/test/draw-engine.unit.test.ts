import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIFFICULTY_LEVEL } from '@iace/contracts';
import { rowAt } from './support/fakes';
import {
  drawSection,
  type DrawCandidate,
  type DrawRequest,
  type DrawSection,
} from '../src/tests/draw-engine';

const SEED = 20260824;

function candidate(id: string, over: Partial<DrawCandidate> = {}): DrawCandidate {
  return {
    id,
    currentVersionId: `${id}_v1`,
    subjectId: 'subject_quant',
    topicId: null,
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    tags: [],
    ...over,
  };
}

/** `n` questions of one subject, named so a test can say which ones came back. */
function pool(count: number, over: Partial<DrawCandidate> = {}, prefix = 'q'): DrawCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`${prefix}${index + 1}`, { ...over }),
  );
}

function section(over: Partial<DrawSection> = {}): DrawSection {
  return {
    id: 'sec_1',
    name: 'Quantitative Aptitude',
    subjectId: null,
    questionCount: 5,
    marksPerQuestion: 2,
    negativeMarks: 0.5,
    ...over,
  };
}

function draw(over: Partial<DrawRequest> = {}) {
  return drawSection({
    section: section(),
    pool: pool(20),
    seed: SEED,
    ...over,
  });
}

/** Every assertion below reads `questions`, which the union only hands over on a whole section. */
function questionsOf(result: ReturnType<typeof drawSection>) {
  assert.ok(result.ok, 'expected a complete section');
  return result.questions;
}

// --------------------------------------------------------------------------- filling
// ---------------------------------------------------------------------------

describe('drawSection — filling the section', () => {
  it('fills the section to its exact count', () => {
    const questions = questionsOf(draw({ section: section({ questionCount: 8 }), pool: pool(40) }));

    assert.equal(questions.length, 8);
    assert.ok(questions.every((row) => row.baseConfigSectionId === 'sec_1'));
  });

  it('never serves one question twice, even from a pool of exactly the size it needs', () => {
    const questions = questionsOf(
      draw({ section: section({ questionCount: 20 }), pool: pool(20) }),
    );

    assert.equal(new Set(questions.map((row) => row.questionId)).size, 20);
  });

  it('numbers the rows 1..N', () => {
    const questions = questionsOf(draw({ section: section({ questionCount: 5 }), pool: pool(10) }));

    assert.deepEqual(
      questions.map((row) => row.order),
      [1, 2, 3, 4, 5],
    );
  });

  it('takes marks from the section and the version from the question', () => {
    const questions = questionsOf(
      draw({
        section: section({ questionCount: 2, marksPerQuestion: 3, negativeMarks: 1 }),
        pool: pool(4),
      }),
    );

    assert.deepEqual(
      questions.map((row) => [row.marks, row.negativeMarks]),
      [
        [3, 1],
        [3, 1],
      ],
    );
    for (const row of questions) {
      assert.equal(row.questionVersionId, `${row.questionId}_v1`);
    }
  });
});

// --------------------------------------------------------------------------- shortfall
// ---------------------------------------------------------------------------

describe('drawSection — a pool too thin to fill the section', () => {
  it('reports the exact gap instead of a short section', () => {
    const result = draw({
      section: section({ id: 'sec_1', name: 'Quantitative Aptitude', questionCount: 25 }),
      pool: pool(18),
    });

    // The failure this prevents: a 25-question section quietly finalized with 18 in it.
    assert.ok(!result.ok);
    assert.deepEqual(result.shortfall, {
      baseConfigSectionId: 'sec_1',
      sectionName: 'Quantitative Aptitude',
      needed: 25,
      available: 18,
    });
  });
});

// --------------------------------------------------------------------------- narrowing
// ---------------------------------------------------------------------------

describe('drawSection — what narrows the pool', () => {
  it('holds the section to its own subject', () => {
    const bank = [
      ...pool(3, { subjectId: 'subject_quant' }, 'quant'),
      ...pool(3, { subjectId: 'subject_reasoning' }, 'reas'),
    ];

    const questions = questionsOf(
      draw({ section: section({ subjectId: 'subject_quant', questionCount: 3 }), pool: bank }),
    );

    assert.ok(questions.every((row) => row.questionId.startsWith('quant')));
  });

  it('takes a question carrying ANY of the section’s tags', () => {
    const bank = [
      ...pool(3, { tags: ['ssc cgl'] }, 'cgl'),
      ...pool(3, { tags: ['previous paper'] }, 'pyq'),
      ...pool(3, { tags: ['banking'] }, 'bank'),
    ];

    const questions = questionsOf(
      draw({
        section: section({ questionCount: 6 }),
        pool: bank,
        spec: { tags: ['ssc cgl', 'previous paper'] },
      }),
    );

    // Tags name facets of a pool, not a set every question has to carry at once.
    assert.equal(questions.length, 6);
    assert.ok(questions.every((row) => !row.questionId.startsWith('bank')));
  });

  it('drops a question with no topic when the section names topics', () => {
    const bank = [
      ...pool(4, { topicId: 'topic_percentages' }, 'pct'),
      ...pool(4, { topicId: null }, 'untagged'),
    ];

    const questions = questionsOf(
      draw({
        section: section({ questionCount: 4 }),
        pool: bank,
        spec: { topicIds: ['topic_percentages'] },
      }),
    );

    assert.ok(questions.every((row) => row.questionId.startsWith('pct')));
  });

  it('reads a section that chose nothing as all of them, not none', () => {
    // The Prisma `in: []` trap, one layer up: an empty set must not blank the pool.
    const questions = questionsOf(
      draw({
        section: section({ questionCount: 3 }),
        pool: pool(10),
        spec: { tags: [], topicIds: [] },
      }),
    );

    assert.equal(questions.length, 3);
  });

  it('lets a section subject and its own topics that disagree empty the pool', () => {
    const result = draw({
      section: section({ subjectId: 'subject_quant', questionCount: 3 }),
      pool: pool(10, { subjectId: 'subject_quant', topicId: 'topic_pct' }),
      spec: { topicIds: ['topic_ratios'] },
    });

    assert.ok(!result.ok);
    assert.equal(result.shortfall.available, 0);
  });
});

// --------------------------------------------------------------------------- determinism
// ---------------------------------------------------------------------------

describe('drawSection — the seed', () => {
  it('gives the same rows for the same seed and pool', () => {
    const options = { section: section({ questionCount: 6 }), pool: pool(30) };

    const first = questionsOf(draw({ ...options, seed: 7 }));
    const again = questionsOf(draw({ ...options, seed: 7 }));

    // What makes a finalize reproducible, and a re-draw a decision rather than a dice roll.
    assert.deepEqual(first, again);
  });

  it('gives different rows for a different seed', () => {
    const options = { section: section({ questionCount: 6 }), pool: pool(30) };

    const first = questionsOf(draw({ ...options, seed: 7 })).map((row) => row.questionId);
    const other = questionsOf(draw({ ...options, seed: 8 })).map((row) => row.questionId);

    assert.notDeepEqual(first, other);
  });

  it('gives a different seed a different SET of questions, not one set reordered', () => {
    const options = { section: section({ questionCount: 20 }), pool: pool(200) };

    const papers = Array.from({ length: 10 }, (_, offset) =>
      questionsOf(draw({ ...options, seed: 1000 + offset }))
        .map((row) => row.questionId)
        .sort((a, b) => a.localeCompare(b))
        .join(','),
    );

    // The failure this prevents: a rank applied after the shuffle gave every seed one set of questions.
    assert.equal(new Set(papers).size, 10);
  });

  it('gives the same rows however the pool arrived', () => {
    const bank = pool(30);
    const options = { section: section({ questionCount: 6 }), seed: 7 };

    const forwards = questionsOf(draw({ ...options, pool: bank })).map((row) => row.questionId);
    const backwards = questionsOf(draw({ ...options, pool: [...bank].reverse() })).map(
      (row) => row.questionId,
    );

    // The failure this prevents: the same seed and rows, a different order, a different paper.
    assert.deepEqual(forwards, backwards);
  });
});

// --------------------------------------------------------------------------- manual picks
// ---------------------------------------------------------------------------

describe('drawSection — a section the admin has had a hand in', () => {
  it('keeps every hand-picked question and draws only the rest', () => {
    const bank = pool(20);
    const chosen = [rowAt(bank, 3), rowAt(bank, 7)];

    const questions = questionsOf(
      draw({ section: section({ questionCount: 5 }), pool: bank, pins: chosen }),
    );

    assert.equal(questions.length, 5);
    // First, and in the order they were chosen: the admin's paper reads the way they built it.
    assert.deepEqual(
      questions.slice(0, 2).map((row) => row.questionId),
      ['q4', 'q8'],
    );
    assert.equal(new Set(questions.map((row) => row.questionId)).size, 5);
  });

  it('a fully hand-picked section leaves the draw nothing to do', () => {
    const bank = pool(10);

    const questions = questionsOf(
      draw({
        section: section({ questionCount: 2 }),
        pool: bank,
        pins: [rowAt(bank, 5), rowAt(bank, 2)],
      }),
    );

    assert.deepEqual(
      questions.map((row) => row.questionId),
      ['q6', 'q3'],
    );
  });
});

describe('drawSection — a section drawn to a difficulty split', () => {
  const mixedBank = [
    ...pool(20, { difficulty: DIFFICULTY_LEVEL.LOW }, 'low'),
    ...pool(20, { difficulty: DIFFICULTY_LEVEL.MEDIUM }, 'med'),
    ...pool(20, { difficulty: DIFFICULTY_LEVEL.HIGH }, 'high'),
  ];

  const countsOf = (rows: readonly { questionId: string }[]) => ({
    low: rows.filter((row) => row.questionId.startsWith('low')).length,
    med: rows.filter((row) => row.questionId.startsWith('med')).length,
    high: rows.filter((row) => row.questionId.startsWith('high')).length,
  });

  it('draws exactly the split it was given', () => {
    const questions = questionsOf(
      draw({
        section: section({ questionCount: 25 }),
        pool: mixedBank,
        spec: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } },
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 7, med: 11, high: 7 });
  });

  it('draws none of a difficulty the split asked nothing of', () => {
    const questions = questionsOf(
      draw({
        section: section({ questionCount: 10 }),
        pool: mixedBank,
        spec: { mix: { LOW: 5, MEDIUM: 0, HIGH: 5 } },
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 5, med: 0, high: 5 });
  });

  /** The failure this prevents: three hard pins leaving a section with ten hard questions on it. */
  it('counts a hand-picked question against its OWN bucket', () => {
    const questions = questionsOf(
      draw({
        section: section({ questionCount: 25 }),
        pool: mixedBank,
        spec: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } },
        pins: mixedBank.filter((row) => row.id.startsWith('high')).slice(0, 3),
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 7, med: 11, high: 7 });
  });

  it('is short by the bucket, not by the section, when one difficulty runs out', () => {
    const thin = [
      ...pool(20, { difficulty: DIFFICULTY_LEVEL.LOW }, 'low'),
      ...pool(20, { difficulty: DIFFICULTY_LEVEL.MEDIUM }, 'med'),
      ...pool(3, { difficulty: DIFFICULTY_LEVEL.HIGH }, 'high'),
    ];

    const result = draw({
      section: section({ questionCount: 25 }),
      pool: thin,
      spec: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } },
    });

    assert.ok(!result.ok);
    assert.equal(result.shortfall.available, 21);
  });

  /** The top-up a hand-picked section asks for: three already on it, a split of 25 to reach. */
  it('fills a section that already holds pins to the whole of its split', () => {
    const pins = [
      rowAt(mixedBank.filter((row) => row.id.startsWith('low'))),
      ...mixedBank.filter((row) => row.id.startsWith('med')).slice(0, 2),
    ];

    const questions = questionsOf(
      draw({
        section: section({ questionCount: 25 }),
        pool: mixedBank,
        spec: { mix: { LOW: 8, MEDIUM: 12, HIGH: 5 } },
        pins,
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 8, med: 12, high: 5 });
    // A pin is never drawn a second time, so 25 rows are 25 different questions.
    assert.equal(new Set(questions.map((row) => row.questionId)).size, 25);
    for (const pin of pins) {
      assert.equal(questions.filter((row) => row.questionId === pin.id).length, 1);
    }
  });

  /** What a caller topping up a paper has to undo: the pins come BACK, numbered from 1. */
  it('hands the pins back among the rows it drew, numbered from one', () => {
    const pins = mixedBank.filter((row) => row.id.startsWith('high')).slice(0, 2);

    const questions = questionsOf(
      draw({ section: section({ questionCount: 5 }), pool: mixedBank, pins }),
    );

    assert.deepEqual(
      questions.slice(0, 2).map((row) => row.questionId),
      pins.map((pin) => pin.id),
    );
    assert.deepEqual(
      questions.map((row) => row.order),
      [1, 2, 3, 4, 5],
    );
  });

  it('draws as it always did when the section has no split', () => {
    const questions = questionsOf(
      draw({ section: section({ questionCount: 12 }), pool: mixedBank }),
    );

    assert.equal(questions.length, 12);
  });
});
