import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  PAPER_SOURCES,
  QUESTION_FLAG_CATEGORY,
  QUESTION_STATUS,
  TEST_SCOPE,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ScoringOutbox } from '../src/attempts/scoring-outbox';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { PaperService } from '../src/tests/paper.service';
import { type Editor } from '../src/tests/edit-lock';
import { SAT_TEST_MESSAGE } from '../src/tests/test-rules';
import { FakeQueue, FakeRedis } from '../test/support/fakes';
import {
  BUILDER,
  makeAdmin,
  makeBankQuestion,
  makeBuilder,
  makeSitting,
  makeStudent,
  resetDatabase,
  testPrisma,
  type BuilderSection,
} from './support/database';

/** One uuid per label, shared across the file so a test can name an id by what it means. */
const idCache = new Map<string, string>();
const labelOf = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  labelOf.set(id, label);
  return id;
};

const TEST = idFor('tst_1');

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Two sections of one config, each on its own subject — the ordinary shape of a paper. */
const SECTIONS: BuilderSection[] = [
  { id: idFor('sec_1'), name: 'Reasoning', subjectId: BUILDER.REASONING, questionCount: 3 },
  { id: idFor('sec_2'), name: 'Quant', subjectId: BUILDER.QUANT, questionCount: 2 },
];

type BankEntry = Parameters<typeof makeBankQuestion>[1];

const bank = (
  count: number,
  subjectId: string,
  prefix: string,
  extra: Partial<BankEntry> = {},
): BankEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: idFor(`${prefix}${index + 1}`),
    subjectId,
    ...extra,
  }));

const ordinaryBank = () => [...bank(6, BUILDER.REASONING, 'r'), ...bank(6, BUILDER.QUANT, 'q')];

/** Reasoning graded two of each difficulty, so a split has something to draw for every bucket. */
const gradedBank = () => [
  ...bank(2, BUILDER.REASONING, 'low', { difficulty: DIFFICULTY_LEVEL.LOW }),
  ...bank(2, BUILDER.REASONING, 'med', { difficulty: DIFFICULTY_LEVEL.MEDIUM }),
  ...bank(2, BUILDER.REASONING, 'high', { difficulty: DIFFICULTY_LEVEL.HIGH }),
  ...bank(6, BUILDER.QUANT, 'q'),
];

/** No low question at all, so a draw against a broken split still finds one and looks filled. */
const thinBank = () => [
  ...bank(1, BUILDER.REASONING, 'med', { difficulty: DIFFICULTY_LEVEL.MEDIUM }),
  ...bank(2, BUILDER.REASONING, 'high', { difficulty: DIFFICULTY_LEVEL.HIGH }),
  ...bank(6, BUILDER.QUANT, 'q'),
];

const oneOfEach = { sections: { [idFor('sec_1')]: { mix: { LOW: 1, MEDIUM: 1, HIGH: 1 } } } };

interface Bench {
  questions?: BankEntry[];
  test?: Partial<Prisma.TestUncheckedCreateInput>;
  sections?: BuilderSection[];
}

/** A draft test on a five-question config, over the bank given. */
async function serviceWith(over: Bench = {}): Promise<PaperService> {
  await makeBuilder(prisma, over.sections ?? SECTIONS, { totalQuestions: 5 });
  for (const question of over.questions ?? ordinaryBank()) {
    await makeBankQuestion(prisma, question);
  }
  const seriesId = idFor('srs_1');
  await prisma.testSeries.create({
    data: { id: seriesId, name: 'SSC CGL 2026 mocks', examStageId: BUILDER.STAGE },
  });
  await prisma.test.create({
    data: {
      id: TEST,
      title: 'Mock 1',
      baseConfigId: BUILDER.CONFIG,
      examStageId: BUILDER.STAGE,
      testSeriesId: seriesId,
      // Picking waits on the source being said, so every bench below has already said it.
      paperSource: PAPER_SOURCES.FRAMED,
      ...over.test,
    },
  });
  const audit = new AuditContext();
  return new PaperService(
    prisma,
    new BaseConfigsService(prisma, new ExamStagesService(prisma, audit), audit),
    new ScoringOutbox(prisma, new FakeQueue().asQueue()),
    audit,
    new FakeRedis().asService(),
  );
}

const rows = () =>
  prisma.paperQuestion.findMany({ where: { testId: TEST }, orderBy: { order: 'asc' } });

const heldIds = async () => (await rows()).map((row) => row.questionId);

/** Somebody has started sitting it, which is what shuts a paper to editing. */
const sat = async () =>
  makeSitting(prisma, { testId: TEST, studentId: (await makeStudent(prisma)).id, score: 0 });

/** A proof-reader's outstanding objection, which is what takes a question out of the draw. */
const flagged = (questionId: string) =>
  prisma.questionFlag.create({
    data: {
      questionId,
      category: QUESTION_FLAG_CATEGORY.INVALID,
      comment: 'The answer key is wrong.',
      raisedById: randomUUID(),
    },
  });

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

/** Picked by hand, so this is how a paper is built up to the counts its config asks. */
async function pickWholePaper(service: PaperService): Promise<void> {
  await service.addQuestions(TEST, {
    baseConfigSectionId: idFor('sec_1'),
    questionIds: [idFor('r1'), idFor('r2'), idFor('r3')],
  });
  await service.addQuestions(TEST, {
    baseConfigSectionId: idFor('sec_2'),
    questionIds: [idFor('q1'), idFor('q2')],
  });
}

describe('PaperService — picking a draft paper by hand', () => {
  it('fills each section to the count its config asks for', async () => {
    const service = await serviceWith();

    await pickWholePaper(service);
    const paper = await service.read(TEST);

    assert.equal(paper.totalQuestions, 5);
    assert.deepEqual(
      paper.sections.map((section) => [section.name, section.questions.length]),
      [
        ['Reasoning', 3],
        ['Quant', 2],
      ],
    );
    assert.equal((await rows()).length, 5);
  });

  it('pins the version each row serves and copies the section’s marks', async () => {
    const service = await serviceWith();

    await pickWholePaper(service);
    const paper = await service.read(TEST);

    for (const row of paper.sections.flatMap((section) => section.questions)) {
      const question = await prisma.question.findUniqueOrThrow({
        where: { id: row.questionId },
        select: { currentVersionId: true },
      });
      assert.equal(row.questionVersionId, question.currentVersionId);
      assert.equal(row.marks, 2);
      assert.equal(row.negativeMarks, 0.5);
    }
  });

  it('puts one on the paper in the next free place', async () => {
    const service = await serviceWith();

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    const [added] = await rows();
    assert.equal(added?.questionId, idFor('q1'));
    assert.equal(added?.baseConfigSectionId, idFor('sec_2'));
    assert.equal(Number(added?.marks), 2);
  });

  /** The failure this prevents: a section quietly holding more questions than its config asks for. */
  it('refuses one more than the section holds', async () => {
    const service = await serviceWith();
    await pickWholePaper(service);

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q3')],
      }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /already holds/);
  });

  it('refuses a question from another subject than the section draws', async () => {
    const service = await serviceWith();

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_1'),
        questionIds: [idFor('q1')],
      }),
    );

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  /** A paper pins a version, so a question with none has nothing to pin. */
  it('refuses a question that is not live in the bank', async () => {
    const service = await serviceWith({
      questions: [
        ...ordinaryBank(),
        { id: idFor('unversioned'), subjectId: BUILDER.QUANT, versioned: false },
      ],
    });

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('unversioned')],
      }),
    );

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.fieldErrors?.questionId?.[0] ?? '', /archived/);
  });

  /** The failure this prevents: "archived" told about a question that was never there at all. */
  it('says a question that is not in the bank is missing, not archived', async () => {
    const service = await serviceWith();

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('gone')],
      }),
    );

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** Promotion to ACTIVE used to be the only way onto a paper, and it is what checked the flags. */
  it('refuses a question carrying an open proof-reading flag, naming the flag', async () => {
    const service = await serviceWith();
    await flagged(idFor('q1'));

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q1')],
      }),
    );

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /open proof-reading flag/);
    assert.deepEqual(await heldIds(), []);
  });
});

describe('PaperService — putting several questions on a section in one request', () => {
  it('lands every question, numbered from the current highest order, in the order sent', async () => {
    const service = await serviceWith();

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r2'), idFor('r1'), idFor('r3')],
    });

    const held = await rows();
    assert.deepEqual(
      held.map((row) => [row.questionId, row.order]),
      [
        [idFor('r2'), 1],
        [idFor('r1'), 2],
        [idFor('r3'), 3],
      ],
    );
  });

  /** The failure this task exists to prevent: an admin cannot tell which of their ticks landed. */
  it('refuses a batch that would take a section past its count, and writes none of it', async () => {
    const service = await serviceWith();

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q1'), idFor('q2'), idFor('q3')],
      }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /Quant already holds the 2 it needs/);
    assert.deepEqual(await heldIds(), []);
  });

  /** The failure this prevents: a hand-picked section quietly written against its own split. */
  it('refuses a batch that would put a difficulty past the split, and writes none of it', async () => {
    const service = await serviceWith({
      questions: gradedBank(),
      test: { questionPoolFilter: oneOfEach },
    });

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_1'),
        questionIds: [idFor('high1'), idFor('high2')],
      }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /more of one difficulty than its split allows/);
    assert.deepEqual(await heldIds(), []);
  });

  it('refuses a batch naming a question already on the paper, and writes none of it', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q2'), idFor('q1')],
      }),
    );

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.deepEqual(await heldIds(), [idFor('q1')]);
  });

  it('refuses a batch naming the same question twice, or one from another subject, and writes none of it', async () => {
    const service = await serviceWith();

    for (const [baseConfigSectionId, questionIds] of [
      [idFor('sec_2'), [idFor('q1'), idFor('q1')]],
      [idFor('sec_1'), [idFor('r1'), idFor('q1')]],
    ] as const) {
      const error = await refused(
        service.addQuestions(TEST, { baseConfigSectionId, questionIds: [...questionIds] }),
      );

      assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
      assert.deepEqual(await heldIds(), []);
    }
  });
});

describe('PaperService — filling a section’s remainder from its own spec', () => {
  const idsOf = (paper: Awaited<ReturnType<PaperService['read']>>, sectionId: string) =>
    paper.sections
      .find((section) => section.baseConfigSectionId === sectionId)
      ?.questions.map((row) => row.questionId) ?? [];

  it('tops the section up to its count and leaves the hand-picked row where it was', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r2')],
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    const paper = await service.fillSection(TEST, idFor('sec_1'));

    assert.equal(idsOf(paper, idFor('sec_1')).length, 3);
    assert.equal(idsOf(paper, idFor('sec_1'))[0], idFor('r2'));
    // The other section is not this draw's business, and keeps exactly what it held.
    assert.deepEqual(idsOf(paper, idFor('sec_2')), [idFor('q1')]);
  });

  /** A DRAFT question is drawable now; only ARCHIVED, or nothing to pin, keeps one out. */
  it('draws from any question not archived, that carries a version', async () => {
    const service = await serviceWith({
      questions: [
        ...bank(3, BUILDER.REASONING, 'r'),
        ...bank(1, BUILDER.QUANT, 'q'),
        { id: idFor('draft'), subjectId: BUILDER.QUANT, status: QUESTION_STATUS.DRAFT },
        { id: idFor('archived'), subjectId: BUILDER.QUANT, status: QUESTION_STATUS.ARCHIVED },
        { id: idFor('unversioned'), subjectId: BUILDER.QUANT, versioned: false },
      ],
    });

    const paper = await service.fillSection(TEST, idFor('sec_2'));

    assert.deepEqual(
      [...idsOf(paper, idFor('sec_2'))].sort(),
      [idFor('q1'), idFor('draft')].sort(),
    );
  });

  /** The failure this prevents: the engine hands the pins back, so a fill writes them a second time. */
  it('writes a row only for what it drew, never for what was already on the paper', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r2')],
    });

    await service.fillSection(TEST, idFor('sec_1'));

    const held = await heldIds();
    assert.equal(held.length, 3);
    assert.equal(new Set(held).size, 3);
  });

  /** `@@unique([testId, order])`: the engine numbers what it drew from 1, this paper cannot. */
  it('numbers what it adds from the paper’s highest order', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1'), idFor('q2')],
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r2')],
    });

    await service.fillSection(TEST, idFor('sec_1'));

    assert.deepEqual(
      (await rows()).map((row) => row.order),
      [1, 2, 3, 4, 5],
    );
  });

  /** `@@unique([testId, questionId])`: a question sits on a paper once, whatever section. */
  it('will not take a question another section holds, even to fill its own split', async () => {
    const service = await serviceWith({
      sections: [
        { id: idFor('sec_a'), name: 'Part A', subjectId: BUILDER.REASONING, questionCount: 3 },
        { id: idFor('sec_b'), name: 'Part B', subjectId: BUILDER.REASONING, questionCount: 1 },
      ],
      // The bank holds exactly one hard question, and Part B is already serving it.
      questions: [
        ...bank(1, BUILDER.REASONING, 'hard', { difficulty: DIFFICULTY_LEVEL.HIGH }),
        ...bank(2, BUILDER.REASONING, 'easy', { difficulty: DIFFICULTY_LEVEL.LOW }),
      ],
      test: {
        questionPoolFilter: {
          sections: { [idFor('sec_a')]: { mix: { LOW: 2, MEDIUM: 0, HIGH: 1 } } },
        },
      },
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_b'),
      questionIds: [idFor('hard1')],
    });

    const error = await refused(service.fillSection(TEST, idFor('sec_a')));

    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.deepEqual(await heldIds(), [idFor('hard1')]);
  });

  it('draws nothing more for a bucket the hand-picking already filled', async () => {
    const service = await serviceWith({
      questions: gradedBank(),
      test: { questionPoolFilter: oneOfEach },
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('high1')],
    });

    const held = idsOf(await service.fillSection(TEST, idFor('sec_1')), idFor('sec_1'));

    assert.equal(held.length, 3);
    assert.deepEqual(
      ['low', 'med', 'high'].map(
        (level) => held.filter((id) => (labelOf.get(id) ?? '').startsWith(level)).length,
      ),
      [1, 1, 1],
    );
  });

  /** The split moved under questions already picked, which is the one way a section gets over one. */
  const pickThenNarrow = async (questions: BankEntry[]) => {
    const service = await serviceWith({
      questions,
      test: {
        questionPoolFilter: {
          sections: { [idFor('sec_1')]: { mix: { LOW: 1, MEDIUM: 0, HIGH: 2 } } },
        },
      },
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('high1'), idFor('high2')],
    });
    await prisma.test.update({ where: { id: TEST }, data: { questionPoolFilter: oneOfEach } });
    return service;
  };

  /** The failure this prevents: a fill that takes a section past the count its config asks for. */
  it('refuses a section whose hand-picking has already broken its split, whatever the bank holds', async () => {
    for (const questions of [gradedBank(), thinBank()]) {
      await resetDatabase(prisma);
      const service = await pickThenNarrow(questions);

      const error = await refused(service.fillSection(TEST, idFor('sec_1')));

      assert.equal(error.code, ErrorCodes.CONFLICT);
      assert.match(error.message, /more of one difficulty than its split allows/);
      assert.deepEqual(await heldIds(), [idFor('high1'), idFor('high2')]);
    }
  });

  it('adds nothing at all to a section already holding its count', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1'), idFor('q2')],
    });

    await service.fillSection(TEST, idFor('sec_2'));

    assert.equal((await rows()).length, 2);
  });

  /** The failure this prevents: a section quietly topped up with fewer than the count it needs. */
  it('reports the gap and writes nothing when the bank cannot fill the rest', async () => {
    const service = await serviceWith({
      questions: [...bank(2, BUILDER.REASONING, 'r'), ...bank(6, BUILDER.QUANT, 'q')],
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });

    const error = await refused(service.fillSection(TEST, idFor('sec_1')));

    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.match(
      error.fieldErrors?.[idFor('sec_1')]?.[0] ?? '',
      /Reasoning needs 3, and the bank holds 2/,
    );
    assert.deepEqual(await heldIds(), [idFor('r1')]);
  });

  /** The draw runs on not-ARCHIVED now, so an open flag is the only thing left between it and a student. */
  it('leaves a question carrying an open proof-reading flag out of the pool', async () => {
    const service = await serviceWith({
      questions: [...bank(3, BUILDER.REASONING, 'r'), ...bank(6, BUILDER.QUANT, 'q')],
    });
    await flagged(idFor('r3'));

    const error = await refused(service.fillSection(TEST, idFor('sec_1')));

    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.match(
      error.fieldErrors?.[idFor('sec_1')]?.[0] ?? '',
      /Reasoning needs 3, and the bank holds 2/,
    );
    assert.deepEqual(await heldIds(), []);
  });

  it('refuses a test a student has already sat', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r2')],
    });
    await sat();

    const error = await refused(service.fillSection(TEST, idFor('sec_1')));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(error.message, SAT_TEST_MESSAGE);
  });

  it('refuses a section this paper does not have', async () => {
    const service = await serviceWith();

    const error = await refused(service.fillSection(TEST, idFor('sec_gone')));

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('PaperService — what it refuses to edit', () => {
  it('refuses a test a student has already sat, and one that does not exist', async () => {
    const service = await serviceWith({ test: { isLocked: true, finalizedAt: new Date() } });
    await sat();
    const addOne = (testId: string) =>
      refused(
        service.addQuestions(testId, {
          baseConfigSectionId: idFor('sec_2'),
          questionIds: [idFor('q1')],
        }),
      );

    assert.equal((await addOne(TEST)).code, ErrorCodes.CONFLICT);
    assert.equal((await addOne(idFor('tst_gone'))).code, ErrorCodes.NOT_FOUND);
  });
});

describe('PaperService — one row at a time', () => {
  /** Picks a whole paper, then hands back the row that holds the first Quant question. */
  async function drawn() {
    const service = await serviceWith();
    await pickWholePaper(service);
    const row = (await rows()).find((candidate) => candidate.questionId === idFor('q1'));
    assert.ok(row);
    return { service, row };
  }

  it('swaps the question and keeps the row where it was', async () => {
    const { service, row } = await drawn();

    await service.replaceQuestion(TEST, row.id, { questionId: idFor('q3') });

    const after = await prisma.paperQuestion.findUniqueOrThrow({ where: { id: row.id } });
    const q3 = await prisma.question.findUniqueOrThrow({
      where: { id: idFor('q3') },
      select: { currentVersionId: true },
    });
    assert.equal(after.questionId, idFor('q3'));
    assert.equal(after.questionVersionId, q3.currentVersionId);
    assert.equal(after.order, row.order);
    assert.equal((await rows()).length, 5);
  });

  /** The failure this prevents: a Quant slot serving a Reasoning question. */
  it('refuses a question from another subject than the section draws', async () => {
    const { service, row } = await drawn();

    const error = await refused(service.replaceQuestion(TEST, row.id, { questionId: idFor('r4') }));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.questionId?.[0]);
  });

  /** `@@unique([testId, questionId])` would refuse it, and a constraint error is not a message. */
  it('refuses a question the paper already holds, by name', async () => {
    const { service, row } = await drawn();

    const error = await refused(service.replaceQuestion(TEST, row.id, { questionId: idFor('q2') }));

    assert.match(error.message, /already on this paper/);
  });

  it('refuses a row that belongs to another test', async () => {
    const { service, row } = await drawn();

    const error = await refused(
      service.replaceQuestion(idFor('tst_other'), row.id, { questionId: idFor('q3') }),
    );

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('drops a row and leaves its section short', async () => {
    const { service, row } = await drawn();

    await service.removeQuestions(TEST, [row.id]);

    const held = await rows();
    assert.equal(held.length, 4);
    assert.equal(
      held.some((candidate) => candidate.id === row.id),
      false,
    );
  });

  it('refuses both once a student has sat the test', async () => {
    const { service, row } = await drawn();
    await sat();

    const replaced = await refused(
      service.replaceQuestion(TEST, row.id, { questionId: idFor('q6') }),
    );
    const removed = await refused(service.removeQuestions(TEST, [row.id]));

    assert.equal(replaced.code, ErrorCodes.CONFLICT);
    assert.equal(removed.code, ErrorCodes.CONFLICT);
  });
});

describe('PaperService — a test only has the sections its scope covers', () => {
  const sectional = () =>
    serviceWith({
      test: { scope: TEST_SCOPE.SECTIONAL, scopeRef: { sectionId: idFor('sec_1') } },
    });

  /** THE failure this prevents: a sectional test whose paper can be built across every section. */
  it('refuses a question added to, or a fill of, a section outside the scope', async () => {
    const service = await sectional();

    const added = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q1')],
      }),
    );
    const filled = await refused(service.fillSection(TEST, idFor('sec_2')));

    assert.equal(added.code, ErrorCodes.NOT_FOUND);
    assert.equal(filled.code, ErrorCodes.NOT_FOUND);
    assert.deepEqual(await heldIds(), []);
  });

  it('still takes a question into the one section it does cover', async () => {
    const service = await sectional();

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });

    assert.deepEqual(await heldIds(), [idFor('r1')]);
  });

  /** The paper a screen reads must not offer a section the server would refuse to fill. */
  it('reads back only the covered section', async () => {
    const service = await sectional();

    const paper = await service.read(TEST);

    assert.deepEqual(
      paper.sections.map((section) => section.baseConfigSectionId),
      [idFor('sec_1')],
    );
  });
});

describe('PaperService — where the questions come from', () => {
  /** The failure this prevents: picking a paper for a test that was going to be typed from scratch. */
  it('refuses a pick until the test says where its questions come from, then allows it', async () => {
    const service = await serviceWith({ test: { paperSource: null } });

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_1'),
        questionIds: [idFor('r1')],
      }),
    );
    assert.equal(error.code, ErrorCodes.CONFLICT);

    // Not a gate a super admin overrides: there is no decision to override, only one to make.
    const asSuperAdmin = await refused(
      service.addQuestions(
        TEST,
        { baseConfigSectionId: idFor('sec_1'), questionIds: [idFor('r1')] },
        { isSuperAdmin: true },
      ),
    );
    assert.equal(asSuperAdmin.code, ErrorCodes.CONFLICT);

    await prisma.test.update({
      where: { id: TEST },
      data: { paperSource: PAPER_SOURCES.PICKED },
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });

    assert.deepEqual(await heldIds(), [idFor('r1')]);
  });

  it('refuses filling and replacing on the same grounds', async () => {
    const service = await serviceWith({ test: { paperSource: null } });

    assert.equal(
      (await refused(service.fillSection(TEST, idFor('sec_1')))).code,
      ErrorCodes.CONFLICT,
    );
    assert.equal(
      (await refused(service.replaceQuestion(TEST, randomUUID(), { questionId: idFor('r1') })))
        .code,
      ErrorCodes.CONFLICT,
    );
  });
});

describe("PaperService — a section that is its typist's job", () => {
  /** The failure this prevents: two people filling one section, each unaware of the other. */
  async function assigned(finalized: Date | null, role: 'TYPIST' | 'PROOFREADER' = 'TYPIST') {
    const service = await serviceWith();
    const assignee = await makeAdmin(prisma, { fullName: 'Priya' });
    await prisma.questionAssignment.create({
      data: {
        id: randomUUID(),
        testId: TEST,
        baseConfigId: BUILDER.CONFIG,
        baseConfigSectionId: idFor('sec_2'),
        assigneeId: assignee.id,
        role,
        finalizedAt: finalized,
      },
    });
    return service;
  }

  it('refuses a pick while the section is still with its typist, and names who has it', async () => {
    const service = await assigned(null);

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor('q1')],
      }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /Priya/);
  });

  /** The override: a typist who has left the institute cannot hold a section hostage. */
  it('lets a super admin pick into the very section it just refused', async () => {
    const service = await assigned(null);

    const paper = await service.addQuestions(
      TEST,
      { baseConfigSectionId: idFor('sec_2'), questionIds: [idFor('q1')] },
      { isSuperAdmin: true },
    );

    assert.ok(paper.sections.some((section) => section.questions.length > 0));
  });

  it('refuses filling it from the spec too', async () => {
    const service = await assigned(null);

    const error = await refused(service.fillSection(TEST, idFor('sec_2')));

    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('lets the pick through once the section has been marked done', async () => {
    const service = await assigned(new Date());

    const paper = await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    assert.ok(paper.sections.some((section) => section.questions.length > 0));
  });

  /** What makes a PICKED test work at all: its reader must not block the picking they are to read. */
  it('lets the pick through while only its proof-reader is outstanding', async () => {
    const service = await assigned(null, 'PROOFREADER');

    const paper = await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    assert.ok(paper.sections.some((section) => section.questions.length > 0));
  });

  it('leaves a section nobody was assigned alone', async () => {
    const service = await assigned(null);

    const paper = await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });

    assert.ok(paper.sections.some((section) => section.questions.length > 0));
  });
});

describe('PaperService — two admins on one paper', () => {
  const pick = (service: PaperService, questionId: string, editor: Editor) =>
    service.addQuestions(
      TEST,
      { baseConfigSectionId: idFor('sec_1'), questionIds: [questionId] },
      editor,
    );

  /** The failure this prevents: the second admin's work looks fine until the counts disagree. */
  it('refuses the second admin by name, and leaves the paper as the first left it', async () => {
    const service = await serviceWith();
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi' });

    await pick(service, idFor('r1'), { id: priya.id });
    const error = await refused(pick(service, idFor('r2'), { id: ravi.id }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /Priya/);
    assert.deepEqual(await heldIds(), [idFor('r1')]);
  });

  it('lets the admin holding it carry on', async () => {
    const service = await serviceWith();
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });

    await pick(service, idFor('r1'), { id: priya.id });
    await pick(service, idFor('r2'), { id: priya.id });

    assert.deepEqual(await heldIds(), [idFor('r1'), idFor('r2')]);
  });

  /** An admin who closed their laptop holding it is the lockout the override exists for. */
  it('hands it to a super admin, and refuses the first admin after', async () => {
    const service = await serviceWith();
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const ravi = await makeAdmin(prisma, { fullName: 'Ravi', isSuperAdmin: true });

    await pick(service, idFor('r1'), { id: priya.id });
    await pick(service, idFor('r2'), { id: ravi.id, isSuperAdmin: true });

    assert.deepEqual(await heldIds(), [idFor('r1'), idFor('r2')]);
    assert.match((await refused(pick(service, idFor('r3'), { id: priya.id }))).message, /Ravi/);
  });
});
