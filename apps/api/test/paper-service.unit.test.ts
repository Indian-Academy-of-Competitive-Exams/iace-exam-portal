import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, PAPER_BINDING } from '@iace/contracts';
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
    assert.match(error.fieldErrors?.sec_2?.[0] ?? '', /Quant needs 2, and only 1 are available/);
    assert.equal(prisma.paperQuestions.length, 0);
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
