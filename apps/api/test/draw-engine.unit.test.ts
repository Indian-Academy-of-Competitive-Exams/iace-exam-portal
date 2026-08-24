import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIFFICULTY_LEVEL, DRAW_STRATEGY, type DrawStrategy } from '@iace/contracts';
import {
  drawPaper,
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    fixedUseCount: 0,
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
    order: 1,
    subjectId: null,
    questionCount: 5,
    marksPerQuestion: 2,
    negativeMarks: 0.5,
    ...over,
  };
}

function draw(over: Partial<DrawRequest> = {}) {
  return drawPaper({
    sections: [section()],
    pool: pool(20),
    strategy: DRAW_STRATEGY.RANDOM,
    seed: SEED,
    ...over,
  });
}

/** Every assertion below reads `questions`, which the union only hands over on a whole paper. */
function questionsOf(result: ReturnType<typeof drawPaper>) {
  assert.ok(result.ok, 'expected a complete paper');
  return result.questions;
}

// --------------------------------------------------------------------------- filling
// ---------------------------------------------------------------------------

describe('drawPaper — filling every section', () => {
  const STRATEGIES: DrawStrategy[] = [
    DRAW_STRATEGY.RANDOM,
    DRAW_STRATEGY.NEWEST_FIRST,
    DRAW_STRATEGY.LEAST_SERVED,
    DRAW_STRATEGY.UNSEEN_FIRST,
  ];

  for (const strategy of STRATEGIES) {
    it(`${strategy} fills each section to its exact count`, () => {
      const sections = [
        section({ id: 'sec_1', order: 1, questionCount: 5 }),
        section({ id: 'sec_2', order: 2, questionCount: 8 }),
      ];

      const questions = questionsOf(draw({ sections, pool: pool(40), strategy }));

      assert.equal(questions.length, 13);
      assert.equal(questions.filter((row) => row.baseConfigSectionId === 'sec_1').length, 5);
      assert.equal(questions.filter((row) => row.baseConfigSectionId === 'sec_2').length, 8);
    });
  }

  it('never serves one question twice, even where two sections could both take it', () => {
    // Both sections draw from the same undifferentiated pool of exactly the size they add up to.
    const sections = [
      section({ id: 'sec_1', order: 1, questionCount: 10 }),
      section({ id: 'sec_2', order: 2, questionCount: 10 }),
    ];

    const questions = questionsOf(draw({ sections, pool: pool(20) }));

    assert.equal(new Set(questions.map((row) => row.questionId)).size, 20);
  });

  it('numbers the paper 1..N across sections, in section order', () => {
    const sections = [
      section({ id: 'sec_2', order: 2, questionCount: 3 }),
      section({ id: 'sec_1', order: 1, questionCount: 2 }),
    ];

    const questions = questionsOf(draw({ sections, pool: pool(10) }));

    assert.deepEqual(
      questions.map((row) => row.order),
      [1, 2, 3, 4, 5],
    );
    // The paper reads in the config's order whatever order the sections arrived in.
    assert.deepEqual(
      questions.map((row) => row.baseConfigSectionId),
      ['sec_1', 'sec_1', 'sec_2', 'sec_2', 'sec_2'],
    );
  });

  it('takes marks from the section and the version from the question', () => {
    const sections = [
      section({ id: 'sec_1', order: 1, questionCount: 1, marksPerQuestion: 3, negativeMarks: 1 }),
      section({
        id: 'sec_2',
        order: 2,
        questionCount: 1,
        marksPerQuestion: 2,
        negativeMarks: 0.25,
      }),
    ];

    const questions = questionsOf(draw({ sections, pool: pool(4) }));

    // One paper may mix them: marks are per SECTION, which is the whole reason they are copied.
    assert.deepEqual(
      questions.map((row) => [row.marks, row.negativeMarks]),
      [
        [3, 1],
        [2, 0.25],
      ],
    );
    for (const row of questions) {
      assert.equal(row.questionVersionId, `${row.questionId}_v1`);
    }
  });
});

// --------------------------------------------------------------------------- shortfall
// ---------------------------------------------------------------------------

describe('drawPaper — a pool too thin to fill the paper', () => {
  it('reports the exact gap instead of a short paper', () => {
    const result = draw({
      sections: [section({ id: 'sec_1', name: 'Quantitative Aptitude', questionCount: 25 })],
      pool: pool(18),
    });

    // The failure this prevents: a 25-question paper quietly finalized with 18 in it.
    assert.ok(!result.ok);
    assert.deepEqual(result.shortfalls, [
      {
        baseConfigSectionId: 'sec_1',
        sectionName: 'Quantitative Aptitude',
        needed: 25,
        available: 18,
      },
    ]);
  });

  it('names every short section, not just the first', () => {
    const result = draw({
      sections: [
        section({ id: 'sec_1', name: 'Reasoning', order: 1, questionCount: 10 }),
        section({ id: 'sec_2', name: 'English', order: 2, questionCount: 10 }),
      ],
      pool: pool(4),
    });

    assert.ok(!result.ok);
    assert.deepEqual(
      result.shortfalls.map((gap) => [gap.sectionName, gap.available]),
      [
        ['Reasoning', 4],
        ['English', 0],
      ],
    );
  });

  it('counts what is left after the earlier sections took theirs', () => {
    // 12 questions, section 1 takes 10, so section 2 genuinely has 2 to work with — not 12.
    const result = draw({
      sections: [
        section({ id: 'sec_1', order: 1, questionCount: 10 }),
        section({ id: 'sec_2', order: 2, questionCount: 5 }),
      ],
      pool: pool(12),
    });

    assert.ok(!result.ok);
    assert.deepEqual(
      result.shortfalls.map((gap) => [gap.baseConfigSectionId, gap.needed, gap.available]),
      [['sec_2', 5, 2]],
    );
  });
});

// --------------------------------------------------------------------------- narrowing
// ---------------------------------------------------------------------------

describe('drawPaper — what narrows a section’s pool', () => {
  it('holds a section to its own subject', () => {
    const sections = [
      section({ id: 'sec_1', order: 1, subjectId: 'subject_quant', questionCount: 2 }),
      section({ id: 'sec_2', order: 2, subjectId: 'subject_reasoning', questionCount: 2 }),
    ];
    const bank = [
      ...pool(3, { subjectId: 'subject_quant' }, 'quant'),
      ...pool(3, { subjectId: 'subject_reasoning' }, 'reas'),
    ];

    const questions = questionsOf(draw({ sections, pool: bank }));

    const bySection = (id: string) =>
      questions.filter((row) => row.baseConfigSectionId === id).map((row) => row.questionId);
    assert.ok(bySection('sec_1').every((id) => id.startsWith('quant')));
    assert.ok(bySection('sec_2').every((id) => id.startsWith('reas')));
  });

  it('honours a difficulty filter across the whole test', () => {
    const bank = [
      ...pool(5, { difficulty: DIFFICULTY_LEVEL.LOW }, 'low'),
      ...pool(5, { difficulty: DIFFICULTY_LEVEL.HIGH }, 'high'),
    ];

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 5 })],
        pool: bank,
        filter: { difficulties: [DIFFICULTY_LEVEL.HIGH] },
      }),
    );

    assert.ok(questions.every((row) => row.questionId.startsWith('high')));
  });

  it('takes a question carrying ANY of the filter’s tags', () => {
    const bank = [
      ...pool(3, { tags: ['ssc cgl'] }, 'cgl'),
      ...pool(3, { tags: ['previous paper'] }, 'pyq'),
      ...pool(3, { tags: ['banking'] }, 'bank'),
    ];

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 6 })],
        pool: bank,
        filter: { tags: ['ssc cgl', 'previous paper'] },
      }),
    );

    // Tags name facets of a pool, not a set every question has to carry at once.
    assert.equal(questions.length, 6);
    assert.ok(questions.every((row) => !row.questionId.startsWith('bank')));
  });

  it('drops a question with no topic when the filter names topics', () => {
    const bank = [
      ...pool(4, { topicId: 'topic_percentages' }, 'pct'),
      ...pool(4, { topicId: null }, 'untagged'),
    ];

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 4 })],
        pool: bank,
        filter: { topicIds: ['topic_percentages'] },
      }),
    );

    assert.ok(questions.every((row) => row.questionId.startsWith('pct')));
  });

  it('reads a filter that chose nothing as all of them, not none', () => {
    // The Prisma `in: []` trap, one layer up: an empty set must not blank the pool.
    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 3 })],
        pool: pool(10),
        filter: { subjectIds: [], difficulties: [], tags: [], topicIds: [] },
      }),
    );

    assert.equal(questions.length, 3);
  });

  it('lets a section subject and a test filter that disagree empty the pool', () => {
    const result = draw({
      sections: [section({ subjectId: 'subject_quant', questionCount: 3 })],
      pool: pool(10, { subjectId: 'subject_quant' }),
      filter: { subjectIds: ['subject_reasoning'] },
    });

    assert.ok(!result.ok);
    assert.equal(result.shortfalls[0]?.available, 0);
  });
});

// --------------------------------------------------------------------------- strategies
// ---------------------------------------------------------------------------

describe('drawPaper — what each strategy actually ranks on', () => {
  it('NEWEST_FIRST takes the most recently added', () => {
    const bank = Array.from({ length: 10 }, (_, index) =>
      candidate(`q${index}`, { createdAt: new Date(2026, 0, index + 1) }),
    );

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 3 })],
        pool: bank,
        strategy: DRAW_STRATEGY.NEWEST_FIRST,
      }),
    );

    assert.deepEqual(
      questions.map((row) => row.questionId),
      ['q9', 'q8', 'q7'],
    );
  });

  it('LEAST_SERVED takes the ones fewest papers have used', () => {
    const bank = Array.from({ length: 10 }, (_, index) =>
      candidate(`q${index}`, { fixedUseCount: index }),
    );

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 3 })],
        pool: bank,
        strategy: DRAW_STRATEGY.LEAST_SERVED,
      }),
    );

    assert.deepEqual(
      questions.map((row) => row.questionId),
      ['q0', 'q1', 'q2'],
    );
  });

  it('UNSEEN_FIRST exhausts what the student has not met before falling back', () => {
    const bank = pool(6);

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 4 })],
        pool: bank,
        strategy: DRAW_STRATEGY.UNSEEN_FIRST,
        seen: new Set(['q1', 'q2', 'q3']),
      }),
    );

    const picked = questions.map((row) => row.questionId);
    // All three unseen ones are in; only then does a seen one make up the number.
    assert.equal(new Set(picked.filter((id) => ['q4', 'q5', 'q6'].includes(id))).size, 3);
    assert.equal(picked.filter((id) => ['q1', 'q2', 'q3'].includes(id)).length, 1);
  });

  it('UNSEEN_FIRST with nothing seen is just the seeded draw', () => {
    const bank = pool(20);
    const options = { sections: [section({ questionCount: 5 })], pool: bank };

    const unseen = questionsOf(draw({ ...options, strategy: DRAW_STRATEGY.UNSEEN_FIRST }));
    const random = questionsOf(draw({ ...options, strategy: DRAW_STRATEGY.RANDOM }));

    assert.deepEqual(
      unseen.map((row) => row.questionId),
      random.map((row) => row.questionId),
    );
  });
});

// --------------------------------------------------------------------------- determinism
// ---------------------------------------------------------------------------

describe('drawPaper — the seed', () => {
  it('gives the same paper for the same seed and pool', () => {
    const options = { sections: [section({ questionCount: 6 })], pool: pool(30) };

    const first = questionsOf(draw({ ...options, seed: 7 }));
    const again = questionsOf(draw({ ...options, seed: 7 }));

    // What makes a finalize reproducible, and a re-draw a decision rather than a dice roll.
    assert.deepEqual(first, again);
  });

  it('gives a different paper for a different seed', () => {
    const options = { sections: [section({ questionCount: 6 })], pool: pool(30) };

    const first = questionsOf(draw({ ...options, seed: 7 })).map((row) => row.questionId);
    const other = questionsOf(draw({ ...options, seed: 8 })).map((row) => row.questionId);

    assert.notDeepEqual(first, other);
  });

  it('gives the same paper however the rows arrived', () => {
    const bank = pool(30);
    const options = { sections: [section({ questionCount: 6 })], seed: 7 };

    const forwards = questionsOf(draw({ ...options, pool: bank })).map((row) => row.questionId);
    const backwards = questionsOf(draw({ ...options, pool: [...bank].reverse() })).map(
      (row) => row.questionId,
    );

    // The failure this prevents: the same seed and rows, a different order, a different paper.
    assert.deepEqual(forwards, backwards);
  });
});
