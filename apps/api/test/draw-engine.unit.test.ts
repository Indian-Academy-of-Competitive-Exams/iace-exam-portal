import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIFFICULTY_LEVEL } from '@iace/contracts';
import { rowAt } from './support/fakes';
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
  it('fills each section to its exact count', () => {
    const sections = [
      section({ id: 'sec_1', order: 1, questionCount: 5 }),
      section({ id: 'sec_2', order: 2, questionCount: 8 }),
    ];

    const questions = questionsOf(draw({ sections, pool: pool(40) }));

    assert.equal(questions.length, 13);
    assert.equal(questions.filter((row) => row.baseConfigSectionId === 'sec_1').length, 5);
    assert.equal(questions.filter((row) => row.baseConfigSectionId === 'sec_2').length, 8);
  });

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

  it('takes a question carrying ANY of the section’s tags', () => {
    const bank = [
      ...pool(3, { tags: ['ssc cgl'] }, 'cgl'),
      ...pool(3, { tags: ['previous paper'] }, 'pyq'),
      ...pool(3, { tags: ['banking'] }, 'bank'),
    ];

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 6 })],
        pool: bank,
        spec: { sections: { sec_1: { tags: ['ssc cgl', 'previous paper'] } } },
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
        sections: [section({ questionCount: 4 })],
        pool: bank,
        spec: { sections: { sec_1: { topicIds: ['topic_percentages'] } } },
      }),
    );

    assert.ok(questions.every((row) => row.questionId.startsWith('pct')));
  });

  /** One section's topics must not narrow another's — that is the point of it being per section. */
  it('narrows only the section it was written for', () => {
    const bank = [
      ...pool(3, { subjectId: 'sub_a', topicId: 'topic_pct' }, 'pct'),
      ...pool(3, { subjectId: 'sub_b', topicId: 'topic_syllo' }, 'syllo'),
    ];

    const questions = questionsOf(
      draw({
        sections: [
          section({ id: 'sec_1', subjectId: 'sub_a', questionCount: 2, order: 1 }),
          section({ id: 'sec_2', subjectId: 'sub_b', questionCount: 2, order: 2 }),
        ],
        pool: bank,
        spec: { sections: { sec_1: { topicIds: ['topic_pct'] } } },
      }),
    );

    assert.equal(questions.length, 4);
    assert.equal(questions.filter((row) => row.questionId.startsWith('syllo')).length, 2);
  });

  it('reads a section that chose nothing as all of them, not none', () => {
    // The Prisma `in: []` trap, one layer up: an empty set must not blank the pool.
    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 3 })],
        pool: pool(10),
        spec: { sections: { sec_1: { tags: [], topicIds: [] } } },
      }),
    );

    assert.equal(questions.length, 3);
  });

  it('lets a section subject and its own topics that disagree empty the pool', () => {
    const result = draw({
      sections: [section({ subjectId: 'subject_quant', questionCount: 3 })],
      pool: pool(10, { subjectId: 'subject_quant', topicId: 'topic_pct' }),
      spec: { sections: { sec_1: { topicIds: ['topic_ratios'] } } },
    });

    assert.ok(!result.ok);
    assert.equal(result.shortfalls[0]?.available, 0);
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

// --------------------------------------------------------------------------- manual picks
// ---------------------------------------------------------------------------

describe('drawPaper — a paper the admin has had a hand in', () => {
  it('keeps every hand-picked question and draws only the rest', () => {
    const bank = pool(20);
    const chosen = [rowAt(bank, 3), rowAt(bank, 7)];

    const questions = questionsOf(
      draw({
        sections: [section({ id: 'sec_1', questionCount: 5 })],
        pool: bank,
        pinned: new Map([['sec_1', chosen]]),
      }),
    );

    assert.equal(questions.length, 5);
    // First, and in the order they were chosen: the admin's paper reads the way they built it.
    assert.deepEqual(
      questions.slice(0, 2).map((row) => row.questionId),
      ['q4', 'q8'],
    );
  });

  it('never auto-draws a question a LATER section was pinned to', () => {
    // Section 1 could otherwise take q1 on its way past, and section 2 would serve it again.
    const bank = pool(4);
    const sections = [
      section({ id: 'sec_1', order: 1, questionCount: 3 }),
      section({ id: 'sec_2', order: 2, questionCount: 1 }),
    ];

    const questions = questionsOf(
      draw({ sections, pool: bank, pinned: new Map([['sec_2', [rowAt(bank)]]]) }),
    );

    assert.equal(new Set(questions.map((row) => row.questionId)).size, 4);
    assert.equal(questions.find((row) => row.baseConfigSectionId === 'sec_2')?.questionId, 'q1');
  });

  it('a fully hand-picked section leaves the draw nothing to do', () => {
    const bank = pool(10);

    const questions = questionsOf(
      draw({
        sections: [section({ id: 'sec_1', questionCount: 2 })],
        pool: bank,
        pinned: new Map([['sec_1', [rowAt(bank, 5), rowAt(bank, 2)]]]),
      }),
    );

    assert.deepEqual(
      questions.map((row) => row.questionId),
      ['q6', 'q3'],
    );
  });
});

describe('drawPaper — a section drawn to a difficulty split', () => {
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
        sections: [section({ questionCount: 25 })],
        pool: mixedBank,
        spec: { sections: { sec_1: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } } } },
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 7, med: 11, high: 7 });
  });

  it('draws none of a difficulty the split asked nothing of', () => {
    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 10 })],
        pool: mixedBank,
        spec: { sections: { sec_1: { mix: { LOW: 5, MEDIUM: 0, HIGH: 5 } } } },
      }),
    );

    assert.deepEqual(countsOf(questions), { low: 5, med: 0, high: 5 });
  });

  /** The failure this prevents: three hard pins leaving a section with ten hard questions on it. */
  it('counts a hand-picked question against its OWN bucket', () => {
    const pins = new Map([
      ['sec_1', mixedBank.filter((row) => row.id.startsWith('high')).slice(0, 3)],
    ]);

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 25 })],
        pool: mixedBank,
        spec: { sections: { sec_1: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } } } },
        pinned: pins,
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
      sections: [section({ questionCount: 25 })],
      pool: thin,
      spec: { sections: { sec_1: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } } } },
    });

    assert.ok(!result.ok);
    assert.equal(result.shortfalls[0]?.available, 21);
  });

  /** The top-up a hand-picked section asks for: three already on it, a split of 25 to reach. */
  it('fills a section that already holds pins to the whole of its split', () => {
    const pins = [
      rowAt(mixedBank.filter((row) => row.id.startsWith('low'))),
      ...mixedBank.filter((row) => row.id.startsWith('med')).slice(0, 2),
    ];

    const questions = questionsOf(
      draw({
        sections: [section({ questionCount: 25 })],
        pool: mixedBank,
        spec: { sections: { sec_1: { mix: { LOW: 8, MEDIUM: 12, HIGH: 5 } } } },
        pinned: new Map([['sec_1', pins]]),
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
      draw({
        sections: [section({ questionCount: 5 })],
        pool: mixedBank,
        pinned: new Map([['sec_1', pins]]),
      }),
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
      draw({ sections: [section({ questionCount: 12 })], pool: mixedBank }),
    );

    assert.equal(questions.length, 12);
  });
});
