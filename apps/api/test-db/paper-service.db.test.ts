import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  AppException,
  ASSIGNMENT_ROLES,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  PAPER_SOURCES,
  QUESTION_STATUS,
  TEST_SCOPE,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { QuestionsService } from '../src/questions/questions.service';
import { FinalizeService } from '../src/tests/finalize.service';
import { OfferingService } from '../src/tests/offering.service';
import { PaperService } from '../src/tests/paper.service';
import { type Editor } from '../src/tests/edit-lock';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';
import { SAT_TEST_MESSAGE } from '../src/tests/test-rules';
import { sectionEditingBy, takeSectionEditLock } from '../src/common/edit-lock';
import { OFFERED_TEST_MESSAGE } from '../src/common/paper-edit';
import { FakeEventBus, FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  BUILDER,
  fourOptions,
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
  client?: PrismaService;
  audit?: AuditContext;
  redis?: RedisService;
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
      // Drawing from a bank IS picking; the framed benches below say so for themselves.
      paperSource: PAPER_SOURCES.PICKED,
      ...over.test,
    },
  });
  const audit = over.audit ?? new AuditContext();
  const redis = over.redis ?? new FakeRedis().asService();
  return new PaperService(
    over.client ?? prisma,
    new BaseConfigsService(
      prisma,
      new ExamStagesService(prisma, audit, new FakeEventBus().asService()),
      audit,
      redis,
      new FakeEventBus().asService(),
    ),
    audit,
    redis,
    new QuestionsService(prisma, audit, new FakeStorage() as never),
  );
}

const idsOf = (paper: Awaited<ReturnType<PaperService['read']>>, sectionId: string) =>
  paper.sections
    .find((section) => section.baseConfigSectionId === sectionId)
    ?.questions.map((row) => row.questionId) ?? [];

const rows = () =>
  prisma.paperQuestion.findMany({ where: { testId: TEST }, orderBy: { order: 'asc' } });

const heldIds = async () => (await rows()).map((row) => row.questionId);

const versionOf = async () =>
  (await prisma.test.findUniqueOrThrow({ where: { id: TEST } })).version;

/** Somebody has started sitting it, which is what shuts a paper to editing. */
const sat = async () =>
  makeSitting(prisma, { testId: TEST, studentId: (await makeStudent(prisma)).id, score: 0 });

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

/** The real client, failing the leftovers' detach — the last write a Done makes, after the paper moved. */
function failingDetach(): PrismaService {
  const question = (delegate: Prisma.TransactionClient['question']) =>
    new Proxy(delegate, {
      get(inner, method: string | symbol) {
        if (method !== 'updateMany') return Reflect.get(inner, method) as unknown;
        return (args: Prisma.QuestionUpdateManyArgs) =>
          args.data.assignmentId === null
            ? Promise.reject(new Error('connection dropped'))
            : inner.updateMany(args);
      },
    });
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get: (inner, member: string | symbol) =>
                member === 'question' ? question(inner.question) : Reflect.get(inner, member),
            }),
          ),
        );
    },
  });
}

/** The real client, whose next transaction opens only once `first.run` has landed: the other call won the race. */
function landingFirst(first: { run?: () => Promise<unknown> }): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return async (...args: Parameters<PrismaService['$transaction']>) => {
        const { run } = first;
        first.run = undefined;
        await run?.();
        return target.$transaction(...args);
      };
    },
  });
}

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

  /** The failure this prevents: a per-question check, so a section's worth of ticks is a hundred reads. */
  it('checks every question in the batch with a fixed number of reads', async () => {
    const reads: string[] = [];
    const service = await serviceWith({ client: countingReads(prisma, reads) });

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1'), idFor('r2'), idFor('r3')],
    });

    // One section, one read of the questions, one of what is drawable, one of what the paper holds.
    assert.equal(reads.filter((call) => call === 'question.findMany').length, 2);
    assert.equal(reads.filter((call) => call === 'baseConfigSection.findUnique').length, 1);
    assert.equal(reads.filter((call) => call === 'question.findUnique').length, 0);
    assert.equal(reads.filter((call) => call === 'question.count').length, 0);
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

  /** Only ARCHIVED, or nothing to pin, keeps a question out of the draw. */
  it('draws from any question not archived, that carries a version', async () => {
    const service = await serviceWith({
      questions: [
        ...bank(3, BUILDER.REASONING, 'r'),
        ...bank(1, BUILDER.QUANT, 'q'),
        { id: idFor('spare'), subjectId: BUILDER.QUANT },
        { id: idFor('archived'), subjectId: BUILDER.QUANT, status: QUESTION_STATUS.ARCHIVED },
        { id: idFor('unversioned'), subjectId: BUILDER.QUANT, versioned: false },
      ],
    });

    const paper = await service.fillSection(TEST, idFor('sec_2'));

    assert.deepEqual(
      [...idsOf(paper, idFor('sec_2'))].sort(),
      [idFor('q1'), idFor('spare')].sort(),
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
    const service = await serviceWith({ test: { finalizedAt: new Date() } });
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

  /** The failure this prevents: a swap tipping a section over the split an add would refuse. */
  it('refuses a question whose difficulty the split is full of, and takes one of the same', async () => {
    const service = await serviceWith({
      questions: gradedBank(),
      test: { questionPoolFilter: oneOfEach },
    });
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('low1'), idFor('med1'), idFor('high1')],
    });
    const low = (await rows()).find((candidate) => candidate.questionId === idFor('low1'));
    assert.ok(low);

    const error = await refused(
      service.replaceQuestion(TEST, low.id, { questionId: idFor('high2') }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /more of one difficulty than its split allows/);
    assert.ok((await heldIds()).includes(idFor('low1')));

    await service.replaceQuestion(TEST, low.id, { questionId: idFor('low2') });
    assert.ok((await heldIds()).includes(idFor('low2')));
  });

  /** The failure this prevents: a live paper changing under students who can already reach it. */
  it('refuses a swap once the test is offered, and leaves the row', async () => {
    const { service, row } = await drawn();
    await prisma.test.update({ where: { id: TEST }, data: { finalizedAt: new Date() } });

    const error = await refused(service.replaceQuestion(TEST, row.id, { questionId: idFor('q3') }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(error.message, OFFERED_TEST_MESSAGE);
    assert.equal((await rows()).find((r) => r.id === row.id)?.questionId, row.questionId);
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

  /** The failure this prevents: a batch half removed, with no way to tell which half landed. */
  it('refuses the whole batch when one row is not on this paper', async () => {
    const { service, row } = await drawn();

    const error = await refused(service.removeQuestions(TEST, [row.id, randomUUID()]));

    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal((await rows()).length, 5);
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

describe("PaperService — a typed section is placed by its typist's Done", () => {
  /** A framed test whose Quant section (two questions) is Priya's, holding what she has typed. */
  async function typed(
    written: readonly string[],
    test: Bench['test'] = {},
    client?: PrismaService,
  ) {
    const service = await serviceWith({
      test: { paperSource: PAPER_SOURCES.FRAMED, ...test },
      client,
    });
    const typist = await makeAdmin(prisma, { fullName: 'Priya' });
    const assignment = await prisma.questionAssignment.create({
      data: {
        id: randomUUID(),
        testId: TEST,
        baseConfigId: BUILDER.CONFIG,
        baseConfigSectionId: idFor('sec_2'),
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
      select: { id: true },
    });
    await prisma.question.updateMany({
      where: { id: { in: written.map(idFor) } },
      data: { assignmentId: assignment.id },
    });
    const done = (selected: string[], discard: string[] = []) =>
      service.typistDone(assignment.id, {
        selected: selected.map(idFor),
        discard: discard.map(idFor),
      });
    const typingDone = async () =>
      (await prisma.questionAssignment.findUniqueOrThrow({ where: { id: assignment.id } }))
        .finalizedAt;
    return { service, assignment, done, typingDone };
  }

  it('places exactly the chosen, sends the rest to the bank, and deletes what was discarded', async () => {
    const { done, typingDone } = await typed(['q1', 'q2', 'q3', 'q4']);

    await done(['q1', 'q2'], ['q3']);

    assert.deepEqual((await heldIds()).sort(), [idFor('q1'), idFor('q2')].sort());
    assert.ok(await typingDone(), 'Done is the hand-over');
    assert.equal(await prisma.question.count({ where: { id: idFor('q3') } }), 0);
    const leftover = await prisma.question.findUniqueOrThrow({ where: { id: idFor('q4') } });
    assert.equal(leftover.assignmentId, null, 'an unticked question is an ordinary bank question');
  });

  /** The failure this prevents: an Offer step opened before a Done freezing a paper its owner never saw. */
  it('moves the test’s version, as every paper edit does', async () => {
    const { done } = await typed(['q1', 'q2']);
    const opened = await versionOf();

    await done(['q1', 'q2']);

    assert.ok((await versionOf()) > opened);
  });

  /** The failure this prevents: a Done that dies part-way leaving the leftovers on a finished section. */
  it('leaves nothing half-applied when a write after the paper fails', async () => {
    const { done, typingDone } = await typed(['q1', 'q2', 'q3', 'q4'], {}, failingDetach());

    await assert.rejects(done(['q1', 'q2'], ['q3']), /connection dropped/);

    assert.equal(await typingDone(), null);
    assert.deepEqual(await heldIds(), []);
    assert.equal(await prisma.question.count({ where: { id: idFor('q3') } }), 1);
    const leftover = await prisma.question.findUniqueOrThrow({ where: { id: idFor('q4') } });
    assert.notEqual(leftover.assignmentId, null);
  });

  /** The failure this prevents: a question typed while a Done was in flight left on the done section for good. */
  it('sends a question typed after the Done began to the bank with the rest', async () => {
    const first: { run?: () => Promise<unknown> } = {};
    const { assignment, done } = await typed(['q1', 'q2'], {}, landingFirst(first));
    first.run = () =>
      prisma.question.update({
        where: { id: idFor('q3') },
        data: { assignmentId: assignment.id },
      });

    await done(['q1', 'q2']);

    const late = await prisma.question.findUniqueOrThrow({ where: { id: idFor('q3') } });
    assert.equal(late.assignmentId, null);
  });

  /** The failure this prevents: a reader handed a section short of its count. */
  it('refuses a choice short of the section’s count, and writes nothing', async () => {
    const { done, typingDone } = await typed(['q1', 'q2']);

    const error = await refused(done(['q1']));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(await typingDone(), null);
    assert.deepEqual(await heldIds(), []);
  });

  it('refuses a question not written for the section', async () => {
    const { done } = await typed(['q1']);

    const error = await refused(done(['q1', 'q2']));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  /** The failure this prevents: a picked paper's typist, who only fixes, closing the section as if typed. */
  it('refuses Done on a picked section, and writes nothing', async () => {
    const { done, typingDone } = await typed(['q1', 'q2'], { paperSource: PAPER_SOURCES.PICKED });

    const error = await refused(done(['q1', 'q2']));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(await typingDone(), null);
    assert.deepEqual(await heldIds(), []);
  });

  it('refuses a choice outside the section’s difficulty split, naming the gap', async () => {
    const mix = { sections: { [idFor('sec_2')]: { mix: { LOW: 1, MEDIUM: 1, HIGH: 0 } } } };
    const { done } = await typed(['q1', 'q2'], { questionPoolFilter: mix });

    const error = await refused(done(['q1', 'q2']));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /Low 0 of 1/);
  });

  it('swaps the rows when the typist chooses again after a send back', async () => {
    const { assignment, done } = await typed(['q1', 'q2', 'q3']);
    await done(['q1', 'q2']);
    await prisma.question.update({
      where: { id: idFor('q3') },
      data: { assignmentId: assignment.id },
    });
    await prisma.questionAssignment.update({
      where: { id: assignment.id },
      data: { finalizedAt: null },
    });

    await done(['q1', 'q3']);

    assert.deepEqual((await heldIds()).sort(), [idFor('q1'), idFor('q3')].sort());
  });

  /** The failure this prevents: an owner changing a paper under the reader who read the typist's choice. */
  it('refuses an owner’s pick or fill on a typed test, but not a super admin’s', async () => {
    const { service } = await typed(['q1', 'q2']);
    const pick = { baseConfigSectionId: idFor('sec_2'), questionIds: [idFor('q1')] };

    assert.equal((await refused(service.addQuestions(TEST, pick))).code, ErrorCodes.CONFLICT);
    assert.equal(
      (await refused(service.fillSection(TEST, idFor('sec_2')))).code,
      ErrorCodes.CONFLICT,
    );
    const paper = await service.addQuestions(TEST, pick, { isSuperAdmin: true });
    assert.deepEqual(idsOf(paper, idFor('sec_2')), [idFor('q1')]);
  });
});

describe('PaperService — a section reaches its proof-reader', () => {
  const reader = async () => {
    const admin = await makeAdmin(prisma, { fullName: 'Ravi' });
    return prisma.questionAssignment.create({
      data: {
        id: randomUUID(),
        testId: TEST,
        baseConfigId: BUILDER.CONFIG,
        baseConfigSectionId: idFor('sec_2'),
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      },
    });
  };
  const handedAt = async (id: string) =>
    (await prisma.questionAssignment.findUniqueOrThrow({ where: { id } })).handedAt;

  it('at the typist’s Done, on a typed section', async () => {
    const service = await serviceWith({ test: { paperSource: PAPER_SOURCES.FRAMED } });
    const reading = await reader();
    const typist = await makeAdmin(prisma, { fullName: 'Priya' });
    const typing = await prisma.questionAssignment.create({
      data: {
        id: randomUUID(),
        testId: TEST,
        baseConfigId: BUILDER.CONFIG,
        baseConfigSectionId: idFor('sec_2'),
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
    });
    await prisma.question.updateMany({
      where: { id: { in: [idFor('q1'), idFor('q2')] } },
      data: { assignmentId: typing.id },
    });

    assert.equal(await handedAt(reading.id), null);
    await service.typistDone(typing.id, { selected: [idFor('q1'), idFor('q2')], discard: [] });

    assert.notEqual(await handedAt(reading.id), null);
  });

  /** The failure this prevents: a reader handed a picked section the owner has not finished picking. */
  it('at the owner’s hand-over, on a picked section, and only once it is full', async () => {
    const service = await serviceWith();
    const reading = await reader();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1')],
    });

    assert.equal((await refused(service.handOver(TEST, idFor('sec_2')))).code, ErrorCodes.CONFLICT);
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q2')],
    });
    await service.handOver(TEST, idFor('sec_2'));

    assert.notEqual(await handedAt(reading.id), null);
    assert.equal(
      (await refused(service.handOver(TEST, idFor('sec_2')))).code,
      ErrorCodes.CONFLICT,
      'a section already with its reader is not handed over twice',
    );
    const [row] = await rows();
    assert.equal(
      (await refused(service.removeQuestions(TEST, [row?.id ?? '']))).code,
      ErrorCodes.CONFLICT,
      'the owner does not move a paper its reader is reading',
    );
  });

  /** The failure this prevents: a reader handed a section its last editor's claim keeps shut for fifteen minutes. */
  it('gives up the section’s edit claim at the hand-over, and not at one it refuses', async () => {
    const redis = new FakeRedis().asService();
    const service = await serviceWith({ redis });
    await reader();
    const pair = { testId: TEST, baseConfigSectionId: idFor('sec_2') };
    const pick = (label: string) =>
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [idFor(label)],
      });
    const editing = async () => (await sectionEditingBy(redis, prisma, pair))?.adminId ?? null;
    const owner = await makeAdmin(prisma, { fullName: 'Asha' });
    await takeSectionEditLock(redis, prisma, pair, owner);
    await pick('q1');

    await refused(service.handOver(TEST, idFor('sec_2')));
    assert.equal(await editing(), owner.id);

    await pick('q2');
    await service.handOver(TEST, idFor('sec_2'));
    assert.equal(await editing(), null);
  });

  /** The failure this prevents: a Hand over action the server then refuses, or none where it would be taken. */
  it('offers the hand-over on the paper only while the server would take it', async () => {
    const service = await serviceWith();
    const offered = async () =>
      (await service.read(TEST)).sections.find(
        (section) => section.baseConfigSectionId === idFor('sec_2'),
      )?.canHandOver;
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q1'), idFor('q2')],
    });

    assert.equal(await offered(), false, 'nobody reads it yet');
    const reading = await reader();
    assert.equal(await offered(), true);
    await service.removeQuestions(TEST, [(await rows())[1]?.id ?? '']);
    assert.equal(await offered(), false, 'the section is short');
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q3')],
    });
    const paper = await service.handOver(TEST, idFor('sec_2'));

    assert.equal(
      paper.sections.find((section) => section.baseConfigSectionId === idFor('sec_2'))?.canHandOver,
      false,
      'it is with its reader now',
    );
    assert.notEqual(await handedAt(reading.id), null);
  });

  it('never offers it on a typed section', async () => {
    const service = await serviceWith({ test: { paperSource: PAPER_SOURCES.FRAMED } });
    await reader();

    const paper = await service.read(TEST);

    assert.ok(paper.sections.every((section) => !section.canHandOver));
  });

  it('never by the owner on a typed section, or to nobody', async () => {
    const typedTest = await serviceWith({ test: { paperSource: PAPER_SOURCES.FRAMED } });
    assert.equal(
      (await refused(typedTest.handOver(TEST, idFor('sec_2')))).code,
      ErrorCodes.CONFLICT,
    );
  });
});

describe('PaperService — a released section changed after its reading', () => {
  /** Quant released by its reader, who checked both questions the paper holds there. */
  async function released() {
    const service = await serviceWith();
    await pickWholePaper(service);
    const admin = await makeAdmin(prisma, { fullName: 'Ravi' });
    const reading = await prisma.questionAssignment.create({
      data: {
        id: randomUUID(),
        testId: TEST,
        baseConfigId: BUILDER.CONFIG,
        baseConfigSectionId: idFor('sec_2'),
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
        handedAt: new Date(),
        finalizedAt: new Date(),
      },
    });
    await prisma.questionReview.createMany({
      data: [idFor('q1'), idFor('q2')].map((questionId) => ({
        testId: TEST,
        baseConfigSectionId: idFor('sec_2'),
        questionId,
        checkedAt: new Date(),
        checkedById: admin.id,
      })),
    });
    const releasedAt = async () =>
      (await prisma.questionAssignment.findUniqueOrThrow({ where: { id: reading.id } }))
        .finalizedAt;
    const rowOf = async (questionId: string) =>
      (await rows()).find((row) => row.questionId === questionId)?.id ?? '';
    return { service, releasedAt, rowOf };
  }

  /** The failure this prevents: a test nobody can offer, holding a question its reader may no longer check. */
  it('goes back to its reader when a question they never checked is swapped in', async () => {
    const { service, releasedAt, rowOf } = await released();

    await service.replaceQuestion(TEST, await rowOf(idFor('q1')), { questionId: idFor('q3') });

    assert.equal(await releasedAt(), null);
  });

  it('goes back to its reader when an unchecked question is added or drawn', async () => {
    for (const refill of [
      (service: PaperService) =>
        service.addQuestions(TEST, {
          baseConfigSectionId: idFor('sec_2'),
          questionIds: [idFor('q3')],
        }),
      (service: PaperService) => service.fillSection(TEST, idFor('sec_2')),
    ]) {
      await resetDatabase(prisma);
      const { service, releasedAt, rowOf } = await released();
      await service.removeQuestions(TEST, [await rowOf(idFor('q2'))]);
      assert.notEqual(await releasedAt(), null, 'a question taken off leaves nothing to read');
      // The fill draws at random, and q2 is back in its pool: unchecked, anything it draws is new to the reader.
      await prisma.questionReview.deleteMany({ where: { questionId: idFor('q2') } });

      await refill(service);

      assert.equal(await releasedAt(), null);
    }
  });

  /** The failure this prevents: a short section with its reader, who cannot release it, and an owner locked out. */
  it('stays with its owner while the section is short, and goes back once it is whole', async () => {
    const { service, releasedAt, rowOf } = await released();
    await service.removeQuestions(TEST, [await rowOf(idFor('q1')), await rowOf(idFor('q2'))]);
    const add = (questionId: string) =>
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_2'),
        questionIds: [questionId],
      });

    await add(idFor('q3'));
    assert.notEqual(await releasedAt(), null);

    await add(idFor('q4'));
    assert.equal(await releasedAt(), null);
  });

  it('stays released when the question put back is one its reader already checked', async () => {
    const { service, releasedAt, rowOf } = await released();
    await service.removeQuestions(TEST, [await rowOf(idFor('q2'))]);

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_2'),
      questionIds: [idFor('q2')],
    });

    assert.notEqual(await releasedAt(), null);
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

const LOCK_ORDER = { TEST: 'the test row', PAPER: 'the paper rows' } as const;

/** Nothing outside the transaction can see a lock, so what it records is the order the statements left in. */
function watchingLocks(order: string[]): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) => work(recordingLocks(tx, order)));
    },
  });
}

function recordingLocks(tx: Prisma.TransactionClient, order: string[]): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(inner, member: string | symbol) {
      if (member === '$queryRaw') {
        return (sql: TemplateStringsArray, ...values: unknown[]) => {
          const statement = sql.join('?');
          if (statement.includes('FROM "Test"') && statement.includes('FOR UPDATE')) {
            order.push(LOCK_ORDER.TEST);
          }
          return inner.$queryRaw(sql, ...values);
        };
      }
      if (member !== 'paperQuestion') return Reflect.get(inner, member) as unknown;
      return new Proxy(inner.paperQuestion, {
        get(delegate, method: string | symbol) {
          if (method !== 'createMany') return Reflect.get(delegate, method) as unknown;
          return (args: Prisma.PaperQuestionCreateManyArgs) => {
            order.push(LOCK_ORDER.PAPER);
            return delegate.createMany(args);
          };
        },
      });
    },
  });
}

describe('PaperService — one lock order, Test before its paper', () => {
  /** The failure this prevents: this and a version rewrite taking the same rows in opposite orders. */
  it('locks the test before it writes the paper row that takes the same test as an FK parent', async () => {
    const order: string[] = [];
    const service = await serviceWith({ client: watchingLocks(order) });

    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });

    assert.deepEqual(order, [LOCK_ORDER.TEST, LOCK_ORDER.PAPER]);
  });
});

describe('PaperService — every paper edit moves the test’s version', () => {
  it('moves it on an add, a replace, a fill and a remove', async () => {
    const service = await serviceWith();
    const first = async () => (await rows())[0]?.id ?? '';
    const edits = [
      () =>
        service.addQuestions(TEST, {
          baseConfigSectionId: idFor('sec_1'),
          questionIds: [idFor('r1')],
        }),
      async () => service.replaceQuestion(TEST, await first(), { questionId: idFor('r2') }),
      () => service.fillSection(TEST, idFor('sec_1')),
      async () => service.removeQuestions(TEST, [await first()]),
    ];

    for (const edit of edits) {
      const opened = await versionOf();
      await edit();
      assert.ok((await versionOf()) > opened);
    }
  });

  /** The failure this prevents: a paper swapped question for question after the Offer step opened, frozen unseen. */
  it('refuses an Offer step opened before a question was swapped, and freezes nothing', async () => {
    const service = await serviceWith();
    await pickWholePaper(service);
    const opened = await versionOf();
    const [row] = await rows();
    await service.replaceQuestion(TEST, row?.id ?? '', { questionId: idFor('r4') });
    const offering = new OfferingService(
      prisma,
      new FakeEventBus().asService(),
      new AuditContext(),
      new FinalizeService(),
    );

    const error = await refused(
      offering.saveOffering(
        TEST,
        { opensAt: null, programOpenings: [], offered: true, expectedVersion: opened },
        false,
      ),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.match(error.message, /changed after you opened its Offer step/);
    const test = await prisma.test.findUniqueOrThrow({ where: { id: TEST } });
    assert.equal(test.finalizedAt, null);
  });
});

describe('PaperService — two writes to one paper at once', () => {
  const add = (service: PaperService, sectionId: string, questions: readonly string[]) =>
    service.addQuestions(TEST, {
      baseConfigSectionId: sectionId,
      questionIds: questions.map(idFor),
    });

  /** The failure this prevents: both reading one highest order, and the loser dying on the unique index. */
  it('lands two adds in places of their own when the section has room', async () => {
    const service = await serviceWith();

    await Promise.all([add(service, idFor('sec_1'), ['r1']), add(service, idFor('sec_1'), ['r2'])]);

    assert.deepEqual(
      (await rows()).map((row) => row.order),
      [1, 2],
    );
    assert.deepEqual((await heldIds()).sort(), [idFor('r1'), idFor('r2')].sort());
  });

  it('tells the add that found the section full so, and never past its count', async () => {
    const service = await serviceWith();

    const settled = await Promise.allSettled([
      add(service, idFor('sec_2'), ['q1', 'q2']),
      add(service, idFor('sec_2'), ['q3']),
    ]);

    const errors = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    assert.equal(errors.length, 1);
    const [error] = errors;
    assert.ok(AppException.is(error));
    assert.match(error.message, /Quant already holds the 2 it needs/);
    assert.ok((await rows()).length <= 2);
  });

  it('leaves a section exactly at its count after two fills', async () => {
    const service = await serviceWith();

    await Promise.all([
      service.fillSection(TEST, idFor('sec_1')),
      service.fillSection(TEST, idFor('sec_1')),
    ]);

    assert.equal((await rows()).length, 3);
  });
});

describe('PaperService — a paper change says what it moved', () => {
  /** The failure this prevents: every add, fill, swap and removal filed as the same bare "Updated". */
  it('files an add, a fill, a swap and a removal with the section and what moved in it', async () => {
    const audit = new AuditContext();
    const service = await serviceWith({ audit });
    const changedBy = (edit: () => Promise<unknown>) =>
      audit.run(async () => {
        await edit();
        return audit.current()?.changed;
      });
    const section = { from: null, to: 'Reasoning' };

    const added = await changedBy(() =>
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_1'),
        questionIds: [idFor('r1')],
      }),
    );
    const [row] = await rows();
    const swapped = await changedBy(() =>
      service.replaceQuestion(TEST, row?.id ?? '', { questionId: idFor('r2') }),
    );
    const filled = await changedBy(() => service.fillSection(TEST, idFor('sec_1')));
    const removed = await changedBy(() => service.removeQuestions(TEST, [row?.id ?? '']));

    assert.deepEqual(added, { section, questionsAdded: { from: null, to: 1 } });
    assert.deepEqual(swapped, { section, questionId: { from: idFor('r1'), to: idFor('r2') } });
    assert.deepEqual(filled, { section, questionsAdded: { from: null, to: 2 } });
    assert.deepEqual(removed, { section, questionsRemoved: { from: null, to: 1 } });
  });
});

describe('PaperService — the paper reads as it is served', () => {
  /** The failure this prevents: the screen showing words the paper does not serve once the bank moved on. */
  it('previews the version each row pins, not the one the question now carries', async () => {
    const service = await serviceWith();
    await service.addQuestions(TEST, {
      baseConfigSectionId: idFor('sec_1'),
      questionIds: [idFor('r1')],
    });
    const reworded = await prisma.questionVersion.create({
      data: {
        id: randomUUID(),
        questionId: idFor('r1'),
        version: 2,
        content: { en: { stem: [{ type: 'TEXT', text: '<p>Reworded since</p>' }] } },
        options: fourOptions(),
      },
    });
    await prisma.question.update({
      where: { id: idFor('r1') },
      data: { currentVersionId: reworded.id },
    });

    const paper = await service.read(TEST);

    const [row] = paper.sections[0]?.questions ?? [];
    assert.equal(row?.question.stemPreview, idFor('r1'));
  });
});

describe('PaperService — an offered paper no longer moves', () => {
  /** The failure this prevents: a live paper changing under students who can already reach it. */
  it('refuses to add to it, and says a question on it may still be dropped', async () => {
    const service = await serviceWith({ test: { finalizedAt: new Date() } });

    const error = await refused(
      service.addQuestions(TEST, {
        baseConfigSectionId: idFor('sec_1'),
        questionIds: [idFor('r1')],
      }),
    );

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(error.message, OFFERED_TEST_MESSAGE);
    assert.deepEqual(await heldIds(), []);
  });

  /** The failure this prevents: an edit that checked a draft landing on the paper an offer froze meanwhile. */
  it('refuses an edit whose test was offered between its check and its write', async () => {
    for (const edit of [
      (service: PaperService) =>
        service.addQuestions(TEST, {
          baseConfigSectionId: idFor('sec_1'),
          questionIds: [idFor('r4')],
        }),
      (service: PaperService) => service.fillSection(TEST, idFor('sec_1')),
      async (service: PaperService) => {
        const [row] = await rows();
        return service.replaceQuestion(TEST, row?.id ?? '', { questionId: idFor('r4') });
      },
      async (service: PaperService) => {
        const [row] = await rows();
        return service.removeQuestions(TEST, [row?.id ?? '']);
      },
    ]) {
      await resetDatabase(prisma);
      const midway = { armed: false };
      const service = await serviceWith({ client: offeredMidway(midway) });
      await pickWholePaper(service);
      await prisma.paperQuestion.deleteMany({ where: { questionId: idFor('r3') } });
      const before = await heldIds();
      midway.armed = true;

      const error = await refused(edit(service));

      assert.equal(error.code, ErrorCodes.CONFLICT);
      assert.equal(error.message, OFFERED_TEST_MESSAGE);
      assert.deepEqual(await heldIds(), before);
    }
  });
});

/** The real client, with an offer landing on the test just before each transaction it opens once armed. */
function offeredMidway(midway: { armed: boolean }): PrismaService {
  return new Proxy(prisma, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return async (...args: Parameters<PrismaService['$transaction']>) => {
        if (midway.armed) {
          await target.test.update({ where: { id: TEST }, data: { finalizedAt: new Date() } });
        }
        return target.$transaction(...args);
      };
    },
  });
}

/** The real client, naming every model read it is asked for so a per-row check cannot hide. */
function countingReads(client: PrismaService, into: string[]): PrismaService {
  const READS = new Set(['findMany', 'findUnique', 'findFirst', 'count']);
  return new Proxy(client, {
    get(target, key) {
      const held = Reflect.get(target, key) as unknown;
      if (
        typeof key !== 'string' ||
        key.startsWith('$') ||
        typeof held !== 'object' ||
        held === null
      ) {
        return held;
      }
      return new Proxy(held, {
        get(model, method) {
          const call = Reflect.get(model, method) as unknown;
          if (typeof method !== 'string' || !READS.has(method)) return call;
          return (...args: unknown[]) => {
            into.push(`${key}.${method}`);
            return Reflect.apply(call as (...a: unknown[]) => unknown, model, args);
          };
        },
      });
    },
  });
}
