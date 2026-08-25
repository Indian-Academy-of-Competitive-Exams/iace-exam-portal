import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, DIFFICULTY_LEVEL, ErrorCodes, PAPER_BINDING } from '@iace/contracts';
import { PaperService } from '../src/tests/paper.service';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  type FakeQuestionRow,
  type FakeSectionRow,
  FakeTestsPrisma,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeTest,
} from './support/fakes';

/** Two sections of one config, each on its own subject — the ordinary shape of a paper. */
const SECTIONS: FakeSectionRow[] = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, subjectId: 'sub_r', questionCount: 3 }),
  makeSection({ id: 'sec_2', name: 'Quant', order: 2, subjectId: 'sub_q', questionCount: 2 }),
];

function bank(count: number, subjectId: string, prefix: string): FakeQuestionRow[] {
  return Array.from({ length: count }, (_, index) =>
    makeQuestion({
      id: `${prefix}${index + 1}`,
      subjectId,
      topicId: null,
      currentVersionId: `${prefix}${index + 1}_v1`,
    }),
  );
}

function serviceWith(
  questions: FakeQuestionRow[] = [...bank(6, 'sub_r', 'r'), ...bank(6, 'sub_q', 'q')],
  test = makeTest({ id: 'tst_1' }),
) {
  const prisma = new FakeTestsPrisma(
    [test],
    [makeBaseConfig({ id: 'cfg_1', totalQuestions: 5 })],
    SECTIONS,
    [],
    [],
    questions,
    [],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  return { prisma, service: new PaperService(prisma.asService(), configs) };
}

const SEED = 42;

describe('PaperService — assembling a draft paper', () => {
  it('fills each section to the count its config asks for', async () => {
    const { service, prisma } = serviceWith();

    const paper = await service.assemble('tst_1', { seed: SEED });

    assert.equal(paper.totalQuestions, 5);
    assert.deepEqual(
      paper.sections.map((section) => [section.name, section.questions.length]),
      [
        ['Reasoning', 3],
        ['Quant', 2],
      ],
    );
    assert.equal(prisma.paperQuestions.length, 5);
  });

  it('pins the version each row serves and copies the section’s marks', async () => {
    const { service } = serviceWith();

    const paper = await service.assemble('tst_1', { seed: SEED });

    for (const row of paper.sections.flatMap((section) => section.questions)) {
      assert.equal(row.questionVersionId, `${row.questionId}_v1`);
      assert.equal(row.marks, 2);
      assert.equal(row.negativeMarks, 0.5);
    }
  });

  it('replaces the paper on a re-draw rather than adding to it', async () => {
    const { service, prisma } = serviceWith();

    await service.assemble('tst_1', { seed: SEED });
    await service.assemble('tst_1', { seed: SEED + 1 });

    // The failure this prevents: a 5-question paper quietly becoming a 10-question one.
    assert.equal(prisma.paperQuestions.length, 5);
  });

  it('draws only from ACTIVE questions that carry a version', async () => {
    const { service } = serviceWith([
      ...bank(3, 'sub_r', 'r'),
      ...bank(2, 'sub_q', 'q'),
      makeQuestion({
        id: 'draft',
        subjectId: 'sub_q',
        currentVersionId: 'draft_v1',
        status: 'DRAFT',
      }),
      makeQuestion({ id: 'unversioned', subjectId: 'sub_q', currentVersionId: null }),
    ]);

    const paper = await service.assemble('tst_1', { seed: SEED });

    const picked = paper.sections.flatMap((section) =>
      section.questions.map((row) => row.questionId),
    );
    // A paper pins a version, so a question without one has nothing to pin.
    assert.ok(!picked.includes('draft'));
    assert.ok(!picked.includes('unversioned'));
  });
});

describe('PaperService — manual picks', () => {
  it('accepts a section chosen by hand and auto-fills the rest', async () => {
    const { service } = serviceWith();

    const paper = await service.assemble('tst_1', {
      seed: SEED,
      manual: [{ baseConfigSectionId: 'sec_1', questionIds: ['r5'] }],
    });

    const reasoning = paper.sections.find((section) => section.name === 'Reasoning')!;
    assert.equal(reasoning.questions.length, 3);
    assert.equal(reasoning.questions[0]?.questionId, 'r5');
    assert.equal(paper.totalQuestions, 5);
  });

  it('keeps every pick when one section was chosen for twice', async () => {
    const { service } = serviceWith();

    const paper = await service.assemble('tst_1', {
      seed: SEED,
      manual: [
        { baseConfigSectionId: 'sec_1', questionIds: ['r5'] },
        { baseConfigSectionId: 'sec_1', questionIds: ['r6'] },
      ],
    });

    // The failure this prevents: the second entry keying over the first, dropping r5 silently.
    const reasoning = paper.sections.find((section) => section.name === 'Reasoning')!;
    assert.deepEqual(
      reasoning.questions.slice(0, 2).map((row) => row.questionId),
      ['r5', 'r6'],
    );
    assert.equal(reasoning.questions.length, 3);
  });

  it('refuses more hand-picked questions than the section holds', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .assemble('tst_1', {
        manual: [{ baseConfigSectionId: 'sec_1', questionIds: ['r1', 'r2', 'r3', 'r4'] }],
      })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.manual?.[0]);
    // Nothing written: a refused paper must not leave half of itself behind.
    assert.equal(prisma.paperQuestions.length, 0);
  });

  it('refuses a hand-picked question from another subject', async () => {
    const { service } = serviceWith();

    const error = await service
      .assemble('tst_1', { manual: [{ baseConfigSectionId: 'sec_1', questionIds: ['q1'] }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses a question that has left the bank', async () => {
    const { service } = serviceWith();

    const error = await service
      .assemble('tst_1', { manual: [{ baseConfigSectionId: 'sec_1', questionIds: ['gone'] }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });
});

describe('PaperService — what it refuses to assemble', () => {
  it('reports the exact gap when the bank is too thin, and writes nothing', async () => {
    const { service, prisma } = serviceWith([...bank(6, 'sub_r', 'r'), ...bank(1, 'sub_q', 'q')]);

    const error = await service.assemble('tst_1', { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.match(error.fieldErrors?.sec_2?.[0] ?? '', /Quant needs 2, and the bank holds 1/);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  /** The failure this prevents: "Quant is short" when what is short is its seven hard questions. */
  it('names the difficulty when a split cannot be filled', async () => {
    const thin = [
      ...bank(6, 'sub_r', 'r'),
      ...bank(6, 'sub_q', 'q').map((question, index) => ({
        ...question,
        difficulty: index === 0 ? DIFFICULTY_LEVEL.HIGH : DIFFICULTY_LEVEL.LOW,
      })),
    ];
    const { service, prisma } = serviceWith(
      thin,
      makeTest({
        id: 'tst_1',
        questionPoolFilter: { sections: { sec_2: { mix: { LOW: 0, MEDIUM: 0, HIGH: 2 } } } },
      }),
    );

    const error = await service.assemble('tst_1', { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.match(error.fieldErrors?.sec_2?.[0] ?? '', /needs 2 high, and the bank holds 1/);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  /** The failure this prevents: a draw using the stored spec while the screen shows another. */
  it('draws from the spec it was handed rather than the one on file', async () => {
    const { service } = serviceWith();

    // The bank holds no low-difficulty questions, so a spec asking for two must refuse.
    const error = await service
      .assemble('tst_1', {
        seed: SEED,
        spec: { sections: { sec_2: { mix: { LOW: 2, MEDIUM: 0, HIGH: 0 } } } },
      })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
  });

  it('stores the spec with the paper it produced, so the two cannot disagree', async () => {
    const { service, prisma } = serviceWith();
    const spec = { sections: { sec_2: { mix: { LOW: 0, MEDIUM: 2, HIGH: 0 } } } };

    await service.assemble('tst_1', { seed: SEED, spec });

    assert.deepEqual(prisma.tests[0]!.questionPoolFilter, spec);
  });

  it('refuses a test a student has already sat', async () => {
    const { service, prisma } = serviceWith(undefined, makeTest({ id: 'tst_1', isLocked: true }));
    prisma.attempts.push({ testId: 'tst_1' });

    const error = await service.assemble('tst_1', { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('refuses a test that draws a fresh paper per student', async () => {
    const { service } = serviceWith(
      undefined,
      makeTest({ id: 'tst_1', paperBinding: PAPER_BINDING.GENERATED }),
    );

    // There is no ONE paper to assemble for a test whose paper is drawn per attempt.
    const error = await service.assemble('tst_1', { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('refuses a test that does not exist', async () => {
    const { service } = serviceWith();

    const error = await service.assemble('tst_gone', { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('PaperService — one row at a time', () => {
  /** Draws a whole paper, then hands back the row that holds a Quant question. */
  async function drawn() {
    const kit = serviceWith();
    await kit.service.assemble('tst_1', { seed: SEED });
    const row = kit.prisma.paperQuestions.find((candidate) =>
      candidate.questionId.startsWith('q'),
    )!;
    return { ...kit, row };
  }

  it('swaps the question and keeps the row where it was', async () => {
    const { service, prisma, row } = await drawn();
    const spare = prisma.questions.find(
      (question) =>
        question.subjectId === 'sub_q' &&
        !prisma.paperQuestions.some((held) => held.questionId === question.id),
    )!;
    const length = prisma.paperQuestions.length;

    await service.replaceQuestion('tst_1', row.id, { questionId: spare.id });

    const after = prisma.paperQuestions.find((candidate) => candidate.id === row.id)!;
    assert.equal(after.questionId, spare.id);
    assert.equal(after.questionVersionId, spare.currentVersionId);
    assert.equal(after.order, row.order);
    assert.equal(prisma.paperQuestions.length, length);
  });

  /** The failure this prevents: a Quant slot serving a Reasoning question. */
  it('refuses a question from another subject than the section draws', async () => {
    const { service, row } = await drawn();

    const error = await service
      .replaceQuestion('tst_1', row.id, { questionId: 'r1' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.questionId?.[0]);
  });

  /** `@@unique([testId, questionId])` would refuse it, and a constraint error is not a message. */
  it('refuses a question the paper already holds, by name', async () => {
    const { service, prisma, row } = await drawn();
    const other = prisma.paperQuestions.find(
      (candidate) => candidate.questionId.startsWith('q') && candidate.id !== row.id,
    )!;

    const error = await service
      .replaceQuestion('tst_1', row.id, { questionId: other.questionId })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /already on this paper/);
  });

  it('refuses a row that belongs to another test', async () => {
    const { service } = await drawn();

    const error = await service
      .replaceQuestion('tst_other', 'pq_tst_1_1', { questionId: 'q1' })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('drops a row and leaves its section short', async () => {
    const { service, prisma, row } = await drawn();
    const length = prisma.paperQuestions.length;

    await service.removeQuestion('tst_1', row.id);

    assert.equal(prisma.paperQuestions.length, length - 1);
    assert.equal(
      prisma.paperQuestions.some((candidate) => candidate.id === row.id),
      false,
    );
  });

  it('refuses both once a student has sat the test', async () => {
    const { service, prisma, row } = await drawn();
    prisma.attempts.push({ testId: 'tst_1' });

    const replaced = await service
      .replaceQuestion('tst_1', row.id, { questionId: 'q6' })
      .catch((e: unknown) => e);
    const removed = await service.removeQuestion('tst_1', row.id).catch((e: unknown) => e);

    assert.ok(AppException.is(replaced));
    assert.equal(replaced.code, ErrorCodes.CONFLICT);
    assert.ok(AppException.is(removed));
    assert.equal(removed.code, ErrorCodes.CONFLICT);
  });
});
