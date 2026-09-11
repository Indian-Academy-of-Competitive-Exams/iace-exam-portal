import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, DIFFICULTY_LEVEL, ErrorCodes } from '@iace/contracts';
import { PaperService } from '../src/tests/paper.service';
import { SAT_TEST_MESSAGE } from '../src/tests/test-rules';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import { TEST_SCOPE } from '@iace/contracts';
import {
  type FakeQuestionRow,
  type FakeSectionRow,
  FakeTestsPrisma,
  fakeScoringOutbox,
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
  sections: FakeSectionRow[] = SECTIONS,
) {
  const prisma = new FakeTestsPrisma(
    [test],
    [makeBaseConfig({ id: 'cfg_1', totalQuestions: 5 })],
    sections,
    [],
    questions,
    [],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  return {
    prisma,
    service: new PaperService(
      prisma.asService(),
      configs,
      fakeScoringOutbox(prisma),
      new AuditContext(),
    ),
  };
}

/** Picked by hand, so this is how a paper is built up to the counts its config asks. */
async function pickWholePaper(service: PaperService): Promise<void> {
  const picks: [string, string[]][] = [
    ['sec_1', ['r1', 'r2', 'r3']],
    ['sec_2', ['q1', 'q2']],
  ];
  for (const [baseConfigSectionId, questionIds] of picks) {
    await service.addQuestions('tst_1', { baseConfigSectionId, questionIds });
  }
}

describe('PaperService — picking a draft paper by hand', () => {
  it('fills each section to the count its config asks for', async () => {
    const { service, prisma } = serviceWith();

    await pickWholePaper(service);
    const paper = await service.read('tst_1');

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

    await pickWholePaper(service);
    const paper = await service.read('tst_1');

    for (const row of paper.sections.flatMap((section) => section.questions)) {
      assert.equal(row.questionVersionId, `${row.questionId}_v1`);
      assert.equal(row.marks, 2);
      assert.equal(row.negativeMarks, 0.5);
    }
  });

  it('puts one on the paper in the next free place', async () => {
    const kit = serviceWith();
    const spare = kit.prisma.questions.find((row) => row.subjectId === 'sub_q');
    assert.ok(spare);

    await kit.service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_2',
      questionIds: [spare.id],
    });

    const added = kit.prisma.paperQuestions.find((row) => row.questionId === spare.id);
    assert.ok(added);
    assert.equal(added.baseConfigSectionId, 'sec_2');
    assert.equal(added.marks, 2);
  });

  /** The failure this prevents: a section quietly holding more questions than its config asks for. */
  it('refuses one more than the section holds', async () => {
    const kit = serviceWith();
    await pickWholePaper(kit.service);

    const error = await kit.service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q3'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /already holds/);
  });

  it('refuses a question from another subject than the section draws', async () => {
    const { service } = serviceWith();

    const error = await service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['q1'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  /** A paper pins a version, so a question with none — or out of the bank — has nothing to pin. */
  it('refuses a question that is not live in the bank', async () => {
    const { service } = serviceWith([
      ...bank(6, 'sub_r', 'r'),
      ...bank(6, 'sub_q', 'q'),
      makeQuestion({ id: 'unversioned', subjectId: 'sub_q', currentVersionId: null }),
    ]);

    for (const questionId of ['gone', 'unversioned']) {
      const error = await service
        .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: [questionId] })
        .catch((e: unknown) => e);

      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(error.fieldErrors?.questionId?.[0]);
    }
  });
});

/** Reasoning graded two of each difficulty, so a split has something to draw for every bucket. */
function gradedBank(): FakeQuestionRow[] {
  return [
    ...bank(2, 'sub_r', 'low').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.LOW })),
    ...bank(2, 'sub_r', 'med').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.MEDIUM })),
    ...bank(2, 'sub_r', 'high').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.HIGH })),
    ...bank(6, 'sub_q', 'q'),
  ];
}

const splitTest = () =>
  makeTest({
    id: 'tst_1',
    questionPoolFilter: { sections: { sec_1: { mix: { LOW: 1, MEDIUM: 1, HIGH: 1 } } } },
  });

/** No low question at all, so a draw against a broken split still finds one and looks filled. */
function thinBank(): FakeQuestionRow[] {
  return [
    ...bank(1, 'sub_r', 'med').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.MEDIUM })),
    ...bank(2, 'sub_r', 'high').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.HIGH })),
    ...bank(6, 'sub_q', 'q'),
  ];
}

/** The split moved under questions already picked, which is the one way a section gets over one. */
async function pickThenNarrow(questions: FakeQuestionRow[]) {
  const test = makeTest({
    id: 'tst_1',
    questionPoolFilter: { sections: { sec_1: { mix: { LOW: 1, MEDIUM: 0, HIGH: 2 } } } },
  });
  const kit = serviceWith(questions, test);
  await kit.service.addQuestions('tst_1', {
    baseConfigSectionId: 'sec_1',
    questionIds: ['high1', 'high2'],
  });
  test.questionPoolFilter = { sections: { sec_1: { mix: { LOW: 1, MEDIUM: 1, HIGH: 1 } } } };
  return kit;
}

describe('PaperService — putting several questions on a section in one request', () => {
  it('lands every question, numbered from the current highest order, in the order sent', async () => {
    const { service, prisma } = serviceWith();

    await service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_1',
      questionIds: ['r2', 'r1', 'r3'],
    });

    const rows = prisma.paperQuestions
      .filter((row) => row.baseConfigSectionId === 'sec_1')
      .sort((a, b) => a.order - b.order);
    assert.deepEqual(
      rows.map((row) => row.questionId),
      ['r2', 'r1', 'r3'],
    );
    assert.deepEqual(
      rows.map((row) => row.order),
      [1, 2, 3],
    );
  });

  /** The failure this task exists to prevent: an admin cannot tell which of their ticks landed. */
  it('refuses a batch that would take a section past its count, and writes none of it', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q1', 'q2', 'q3'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /Quant already holds the 2 it needs/);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  /** The failure this prevents: a hand-picked section quietly written against its own split. */
  it('refuses a batch that would put a difficulty past the split, and writes none of it', async () => {
    const kit = serviceWith(gradedBank(), splitTest());

    const error = await kit.service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['high1', 'high2'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /more of one difficulty than its split allows/);
    assert.equal(kit.prisma.paperQuestions.length, 0);
  });

  it('refuses a batch naming a question already on the paper, and writes none of it', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q1'] });

    const error = await kit.service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q2', 'q1'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(kit.prisma.paperQuestions.length, 1);
  });

  it('refuses a batch naming the same question twice, and writes none of it', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q1', 'q1'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  it('refuses a batch with one question from another subject, and writes none of it', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r1', 'q1'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.paperQuestions.length, 0);
  });
});

describe('PaperService — filling a section’s remainder from its own spec', () => {
  const idsOf = (paper: Awaited<ReturnType<PaperService['read']>>, sectionId: string) =>
    paper.sections
      .find((section) => section.baseConfigSectionId === sectionId)
      ?.questions.map((row) => row.questionId) ?? [];

  it('tops the section up to its count and leaves the hand-picked row where it was', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r2'] });
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q1'] });

    const paper = await kit.service.fillSection('tst_1', 'sec_1');

    assert.equal(idsOf(paper, 'sec_1').length, 3);
    assert.equal(idsOf(paper, 'sec_1')[0], 'r2');
    // The other section is not this draw's business, and keeps exactly what it held.
    assert.deepEqual(idsOf(paper, 'sec_2'), ['q1']);
  });

  it('draws only from ACTIVE questions that carry a version', async () => {
    const kit = serviceWith([
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

    const paper = await kit.service.fillSection('tst_1', 'sec_2');

    // A paper pins a version, so a question without one has nothing to pin.
    assert.deepEqual([...idsOf(paper, 'sec_2')].sort(), ['q1', 'q2']);
  });

  /** The failure this prevents: the engine hands the pins back, so a fill writes them a second time. */
  it('writes a row only for what it drew, never for what was already on the paper', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r2'] });

    await kit.service.fillSection('tst_1', 'sec_1');

    const held = kit.prisma.paperQuestions.map((row) => row.questionId);
    assert.equal(held.length, 3);
    assert.equal(new Set(held).size, 3);
  });

  /** `@@unique([testId, order])`: the engine numbers what it drew from 1, this paper cannot. */
  it('numbers what it adds from the paper’s highest order', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_2',
      questionIds: ['q1', 'q2'],
    });
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r2'] });

    await kit.service.fillSection('tst_1', 'sec_1');

    const orders = kit.prisma.paperQuestions.map((row) => row.order).sort((a, b) => a - b);
    assert.deepEqual(orders, [1, 2, 3, 4, 5]);
  });

  /** `@@unique([testId, questionId])`: a question sits on a paper once, whatever section. */
  it('will not take a question another section holds, even to fill its own split', async () => {
    const shared = [
      makeSection({ id: 'sec_a', name: 'Part A', order: 1, subjectId: 'sub_s', questionCount: 3 }),
      makeSection({ id: 'sec_b', name: 'Part B', order: 2, subjectId: 'sub_s', questionCount: 1 }),
    ];
    // The bank holds exactly one hard question, and Part B is already serving it.
    const graded = [
      ...bank(1, 'sub_s', 'hard').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.HIGH })),
      ...bank(2, 'sub_s', 'easy').map((row) => ({ ...row, difficulty: DIFFICULTY_LEVEL.LOW })),
    ];
    const kit = serviceWith(
      graded,
      makeTest({
        id: 'tst_1',
        questionPoolFilter: { sections: { sec_a: { mix: { LOW: 2, MEDIUM: 0, HIGH: 1 } } } },
      }),
      shared,
    );
    await kit.service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_b',
      questionIds: ['hard1'],
    });

    const error = await kit.service.fillSection('tst_1', 'sec_a').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.deepEqual(
      kit.prisma.paperQuestions.map((row) => row.questionId),
      ['hard1'],
    );
  });

  it('draws nothing more for a bucket the hand-picking already filled', async () => {
    const kit = serviceWith(gradedBank(), splitTest());
    await kit.service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_1',
      questionIds: ['high1'],
    });

    const paper = await kit.service.fillSection('tst_1', 'sec_1');

    const held = idsOf(paper, 'sec_1');
    assert.equal(held.length, 3);
    assert.deepEqual(
      ['low', 'med', 'high'].map((level) => held.filter((id) => id.startsWith(level)).length),
      [1, 1, 1],
    );
  });

  /** The failure this prevents: a fill that takes a section past the count its config asks for. */
  it('refuses a section whose hand-picking has already broken its split', async () => {
    const kit = await pickThenNarrow(gradedBank());

    const error = await kit.service.fillSection('tst_1', 'sec_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /more of one difficulty than its split allows/);
    assert.equal(kit.prisma.paperQuestions.length, 2);
  });

  /** The same broken split against a thinner bank: what is stocked must not decide the verdict. */
  it('refuses it whether or not the bank could fill the buckets left', async () => {
    const kit = await pickThenNarrow(thinBank());

    const error = await kit.service.fillSection('tst_1', 'sec_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /more of one difficulty than its split allows/);
    assert.deepEqual(
      kit.prisma.paperQuestions.map((row) => row.questionId),
      ['high1', 'high2'],
    );
  });

  it('adds nothing at all to a section already holding its count', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', {
      baseConfigSectionId: 'sec_2',
      questionIds: ['q1', 'q2'],
    });

    await kit.service.fillSection('tst_1', 'sec_2');

    assert.equal(kit.prisma.paperQuestions.length, 2);
  });

  /** The failure this prevents: a section quietly topped up with fewer than the count it needs. */
  it('reports the gap and writes nothing when the bank cannot fill the rest', async () => {
    const kit = serviceWith([...bank(2, 'sub_r', 'r'), ...bank(6, 'sub_q', 'q')]);
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r1'] });

    const error = await kit.service.fillSection('tst_1', 'sec_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.match(error.fieldErrors?.sec_1?.[0] ?? '', /Reasoning needs 3, and the bank holds 2/);
    assert.deepEqual(
      kit.prisma.paperQuestions.map((row) => row.questionId),
      ['r1'],
    );
  });

  it('refuses a test a student has already sat', async () => {
    const kit = serviceWith();
    await kit.service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r2'] });
    kit.prisma.attempts.push({ testId: 'tst_1' });

    const error = await kit.service.fillSection('tst_1', 'sec_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(error.message, SAT_TEST_MESSAGE);
  });

  it('refuses a section this paper does not have', async () => {
    const { service } = serviceWith();

    const error = await service.fillSection('tst_1', 'sec_gone').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('PaperService — what it refuses to edit', () => {
  const addOne = (service: PaperService, testId = 'tst_1') =>
    service
      .addQuestions(testId, { baseConfigSectionId: 'sec_2', questionIds: ['q1'] })
      .catch((e: unknown) => e);

  it('refuses a test a student has already sat', async () => {
    const { service, prisma } = serviceWith(undefined, makeTest({ id: 'tst_1', isLocked: true }));
    prisma.attempts.push({ testId: 'tst_1' });

    const error = await addOne(service);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('refuses a test that does not exist', async () => {
    const { service } = serviceWith();

    const error = await addOne(service, 'tst_gone');

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('PaperService — one row at a time', () => {
  /** Picks a whole paper, then hands back the row that holds a Quant question. */
  async function drawn() {
    const kit = serviceWith();
    await pickWholePaper(kit.service);
    const row = kit.prisma.paperQuestions.find((candidate) => candidate.questionId.startsWith('q'));
    assert.ok(row);
    return { ...kit, row };
  }

  it('swaps the question and keeps the row where it was', async () => {
    const { service, prisma, row } = await drawn();
    const spare = prisma.questions.find(
      (question) =>
        question.subjectId === 'sub_q' &&
        !prisma.paperQuestions.some((held) => held.questionId === question.id),
    );
    assert.ok(spare);
    const length = prisma.paperQuestions.length;

    await service.replaceQuestion('tst_1', row.id, { questionId: spare.id });

    const after = prisma.paperQuestions.find((candidate) => candidate.id === row.id);
    assert.ok(after);
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
    );
    assert.ok(other);

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

    await service.removeQuestions('tst_1', [row.id]);

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
    const removed = await service.removeQuestions('tst_1', [row.id]).catch((e: unknown) => e);

    assert.ok(AppException.is(replaced));
    assert.equal(replaced.code, ErrorCodes.CONFLICT);
    assert.ok(AppException.is(removed));
    assert.equal(removed.code, ErrorCodes.CONFLICT);
  });
});

describe('PaperService — a test only has the sections its scope covers', () => {
  const sectional = () =>
    makeTest({ id: 'tst_1', scope: TEST_SCOPE.SECTIONAL, scopeRef: { sectionId: 'sec_1' } });

  /** THE failure this prevents: a sectional test whose paper can be built across every section. */
  it('refuses a question added to a section outside the scope', async () => {
    const { service, prisma } = serviceWith(undefined, sectional());

    const error = await service
      .addQuestions('tst_1', { baseConfigSectionId: 'sec_2', questionIds: ['q1'] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  it('still takes a question into the one section it does cover', async () => {
    const { service, prisma } = serviceWith(undefined, sectional());

    await service.addQuestions('tst_1', { baseConfigSectionId: 'sec_1', questionIds: ['r1'] });

    assert.equal(prisma.paperQuestions.length, 1);
  });

  it('refuses to fill a section outside the scope', async () => {
    const { service, prisma } = serviceWith(undefined, sectional());

    const error = await service.fillSection('tst_1', 'sec_2').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  /** The paper a screen reads must not offer a section the server would refuse to fill. */
  it('reads back only the covered section', async () => {
    const { service } = serviceWith(undefined, sectional());

    const paper = await service.read('tst_1');

    assert.deepEqual(
      paper.sections.map((section) => section.baseConfigSectionId),
      ['sec_1'],
    );
  });
});
