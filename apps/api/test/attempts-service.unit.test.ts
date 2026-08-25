import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  PAPER_BINDING,
  TEST_STATUS,
} from '@iace/contracts';
import { AttemptsService } from '../src/attempts/attempts.service';
import { type AccessResolverService } from '../src/access';
import {
  type FakeAttemptRow,
  type FakePaperRow,
  type FakeTestModelRow,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const STUDENT = 'stu_1';

const SECTIONS = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, subjectId: 'sub_r', questionCount: 3 }),
];

/** Three frozen rows, each pinning a version — the paper a sitting is seeded from. */
function paper(): FakePaperRow[] {
  return [1, 2, 3].map((n) => ({
    id: `pq_${n}`,
    testId: 'tst_1',
    baseConfigId: 'cfg_1',
    baseConfigSectionId: 'sec_1',
    questionId: `q${n}`,
    questionVersionId: `q${n}_v1`,
    variant: 0,
    order: n,
    marks: 2,
    negativeMarks: 0.5,
    status: 'ACTIVE' as const,
  }));
}

/** A finalized, offered test — the only kind that can be sat. */
function sittable(over: Partial<FakeTestModelRow> = {}): FakeTestModelRow {
  return makeTest({ id: 'tst_1', status: TEST_STATUS.ACTIVE, isLocked: true, ...over });
}

/** The resolver is a seam, not this service's job — it either permits or throws. */
function resolver(permitted = true): AccessResolverService {
  return {
    assertCanStart: () =>
      permitted
        ? Promise.resolve()
        : Promise.reject(
            new AppException(ErrorCodes.FORBIDDEN, 'This test is not open to you right now'),
          ),
  } as unknown as AccessResolverService;
}

function serviceWith(
  test = sittable(),
  attempts: FakeAttemptRow[] = [],
  config = makeBaseConfig({
    id: 'cfg_1',
    durationSec: 3600,
    totalQuestions: 3,
    languages: [LANGUAGE_CODE.EN],
  }),
  permitted = true,
) {
  const prisma = new FakeTestsPrisma(
    [test],
    [config],
    SECTIONS,
    [],
    [],
    [],
    paper(),
    [],
    attempts,
    [],
  );
  return { prisma, service: new AttemptsService(prisma.asService(), resolver(permitted)) };
}

describe('AttemptsService — starting a sitting', () => {
  it('gives the student a clock the SERVER set', async () => {
    const { service } = serviceWith();

    const attempt = await service.start(STUDENT, 'tst_1', {});

    // The request said nothing about timing, and the deadline is the config's duration past the start.
    const ran = Date.parse(attempt.endsAt) - Date.parse(attempt.startedAt);
    assert.equal(ran, 3600 * 1000);
    assert.equal(attempt.status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(attempt.startedByThisCall, true);
  });

  it('seeds one row per frozen question, pinning the version each serves', async () => {
    const { service, prisma } = serviceWith();

    const attempt = await service.start(STUDENT, 'tst_1', {});

    assert.equal(attempt.totalQuestions, 3);
    const seeded = prisma.attemptQuestions.filter((row) => row.attemptId === attempt.id);
    assert.equal(seeded.length, 3);
    assert.deepEqual(
      seeded.map((row) => [row.questionId, row.questionVersionId, row.state]),
      [
        ['q1', 'q1_v1', 'NOT_VISITED'],
        ['q2', 'q2_v1', 'NOT_VISITED'],
        ['q3', 'q3_v1', 'NOT_VISITED'],
      ],
    );
  });

  it('shuffles within a section but never across one', async () => {
    const twoSections = [
      makeSection({ id: 'sec_1', order: 1, subjectId: 'sub_r', questionCount: 3 }),
      makeSection({ id: 'sec_2', order: 2, subjectId: 'sub_q', questionCount: 3 }),
    ];
    const spread = [
      ...paper(),
      ...[4, 5, 6].map((n) => ({
        ...paper()[0]!,
        id: `pq_${n}`,
        baseConfigSectionId: 'sec_2',
        questionId: `q${n}`,
        questionVersionId: `q${n}_v1`,
        variant: 0,
        order: n,
      })),
    ];
    const prisma = new FakeTestsPrisma(
      [sittable()],
      [makeBaseConfig({ id: 'cfg_1', durationSec: 3600, shuffleQuestions: true })],
      twoSections,
      [],
      [],
      [],
      spread,
      [],
      [],
      [],
    );
    const service = new AttemptsService(prisma.asService(), resolver());

    const attempt = await service.start(STUDENT, 'tst_1', {});

    // Section tabs would be meaningless if one section's questions interleaved with another's.
    const served = prisma.attemptQuestions
      .filter((row) => row.attemptId === attempt.id)
      .sort((a, b) => a.order - b.order);
    assert.deepEqual(
      served.map((row) => row.baseConfigSectionId),
      ['sec_1', 'sec_1', 'sec_1', 'sec_2', 'sec_2', 'sec_2'],
    );
    assert.deepEqual(
      served.map((row) => row.order),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it('leaves the paper’s order alone when the config says not to shuffle', async () => {
    const { service, prisma } = serviceWith(
      sittable(),
      [],
      makeBaseConfig({ id: 'cfg_1', durationSec: 3600, shuffleQuestions: false }),
    );

    const attempt = await service.start(STUDENT, 'tst_1', {});

    const served = prisma.attemptQuestions.filter((row) => row.attemptId === attempt.id);
    assert.deepEqual(
      served.map((row) => row.questionId),
      ['q1', 'q2', 'q3'],
    );
  });

  it('marks the first sitting graded, and a later one not', async () => {
    const { service, prisma } = serviceWith(sittable({ maxRetakes: 3 }));

    const first = await service.start(STUDENT, 'tst_1', {});
    assert.equal(first.attemptNo, 1);
    assert.equal(first.isGraded, true);

    prisma.attemptRows[0]!.status = ATTEMPT_STATUS.SUBMITTED;

    // The cohort rollup fires on one attempt per student, so a retake must not carry it.
    const second = await service.start(STUDENT, 'tst_1', {});
    assert.equal(second.attemptNo, 2);
    assert.equal(second.isGraded, false);
  });

  it('sits a SINGLE paper in the language the student picked', async () => {
    const { service } = serviceWith(
      sittable(),
      [],
      makeBaseConfig({
        id: 'cfg_1',
        durationSec: 3600,
        languageMode: LANGUAGE_MODE.SINGLE,
        languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
      }),
    );

    const attempt = await service.start(STUDENT, 'tst_1', { languages: [LANGUAGE_CODE.HI] });

    assert.deepEqual(attempt.languages, [LANGUAGE_CODE.HI]);
  });

  it('sits a DUAL paper in both, whatever was asked for', async () => {
    const { service } = serviceWith(
      sittable(),
      [],
      makeBaseConfig({
        id: 'cfg_1',
        durationSec: 3600,
        languageMode: LANGUAGE_MODE.DUAL,
        languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
      }),
    );

    // DUAL renders both with no toggle, so the pick is not the student's to make.
    const attempt = await service.start(STUDENT, 'tst_1', { languages: [LANGUAGE_CODE.EN] });

    assert.deepEqual(attempt.languages, [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI]);
  });
});

describe('AttemptsService — starting twice', () => {
  it('resumes the running sitting rather than starting a second', async () => {
    const { service, prisma } = serviceWith();

    const first = await service.start(STUDENT, 'tst_1', {});
    const again = await service.start(STUDENT, 'tst_1', {});

    // The failure this prevents: a student refreshing the tab and getting a brand new clock.
    assert.equal(again.id, first.id);
    assert.equal(again.endsAt, first.endsAt);
    assert.equal(again.startedByThisCall, false);
    assert.equal(prisma.attemptRows.length, 1);
  });

  it('resolves two concurrent starts to one sitting', async () => {
    const { service, prisma } = serviceWith();

    const [a, b] = await Promise.all([
      service.start(STUDENT, 'tst_1', {}),
      service.start(STUDENT, 'tst_1', {}),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(prisma.attemptRows.length, 1);
    assert.equal(prisma.attemptQuestions.length, 3);
  });

  it('refuses a retake past what the test allows', async () => {
    const done = makeAttempt({
      id: 'att_done',
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: new Date('2026-08-24T05:00:00.000Z'),
    });
    const { service } = serviceWith(sittable({ maxRetakes: 1 }), [done]);

    const error = await service.start(STUDENT, 'tst_1', {}).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });
});

describe('AttemptsService — what cannot be sat', () => {
  it('refuses a test that is not being offered', async () => {
    const { service } = serviceWith(sittable({ status: TEST_STATUS.DRAFT }));

    const error = await service.start(STUDENT, 'tst_1', {}).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('refuses a test whose paper is not frozen', async () => {
    const { service } = serviceWith(sittable({ isLocked: false }));

    const error = await service.start(STUDENT, 'tst_1', {}).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /not been finalized/);
  });

  it('lets the resolver refuse a student who cannot reach it, and writes nothing', async () => {
    const { service, prisma } = serviceWith(sittable(), [], undefined, false);

    const error = await service.start(STUDENT, 'tst_1', {}).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
    assert.equal(prisma.attemptRows.length, 0);
  });
});

describe('AttemptsService — resuming what is already running', () => {
  it('resumes a sitting the window has since closed under', async () => {
    const live = makeAttempt({ id: 'att_live', status: ATTEMPT_STATUS.IN_PROGRESS });
    const { service } = serviceWith(sittable(), [live], undefined, false);

    const resumed = await service.start(STUDENT, 'tst_1', {});

    // The failure this prevents: a reload after the window closes, locking a student out mid-paper.
    assert.equal(resumed.id, 'att_live');
    assert.equal(resumed.startedByThisCall, false);
  });

  it('resumes a sitting on a test that has since been retired', async () => {
    const live = makeAttempt({ id: 'att_live', status: ATTEMPT_STATUS.IN_PROGRESS });
    const { service } = serviceWith(sittable({ status: TEST_STATUS.INACTIVE }), [live]);

    const resumed = await service.start(STUDENT, 'tst_1', {});

    assert.equal(resumed.id, 'att_live');
    assert.equal(resumed.endsAt, live.endsAt.toISOString());
  });
});

describe('AttemptsService — the blueprint stops moving', () => {
  /** The failure this prevents: a config edited to a different shape under a paper being sat. */
  it('locks the config when the first student starts', async () => {
    const { service, prisma } = serviceWith();
    assert.equal(prisma.configs[0]!.locked, false);

    await service.start(STUDENT, 'tst_1', {});

    assert.equal(prisma.configs[0]!.locked, true);
  });

  /** Every student on one test shares one config row, so a write per start would serialise them. */
  it('writes nothing once the config is already locked', async () => {
    const locked = makeBaseConfig({ id: 'cfg_1', durationSec: 3600, locked: true });
    const { service, prisma } = serviceWith(sittable(), [], locked);
    let writes = 0;
    const real = prisma.baseConfig.updateMany;
    prisma.baseConfig.updateMany = ((args: Parameters<typeof real>[0]) => {
      writes += 1;
      return real.call(prisma.baseConfig, args);
    }) as typeof real;

    await service.start(STUDENT, 'tst_1', {});

    assert.equal(writes, 0);
    assert.equal(prisma.configs[0]!.locked, true);
  });

  /** A resume is not a start, and a sitting already under way has locked it long since. */
  it('leaves the config alone when the sitting is only being resumed', async () => {
    const running = makeAttempt({ id: 'att_1', testId: 'tst_1', studentId: STUDENT });
    const { service, prisma } = serviceWith(sittable(), [running]);

    await service.start(STUDENT, 'tst_1', {});

    assert.equal(prisma.configs[0]!.locked, false);
  });
});

describe('AttemptsService — a test with a paper per student', () => {
  /** Two whole papers on file, drawn when the test was frozen. */
  function variants(): FakePaperRow[] {
    return [0, 1].flatMap((variant) =>
      [1, 2, 3].map((n) => ({
        id: `pq_${variant}_${n}`,
        testId: 'tst_1',
        baseConfigId: 'cfg_1',
        baseConfigSectionId: 'sec_1',
        questionId: `v${variant}q${n}`,
        questionVersionId: `v${variant}q${n}_v1`,
        variant,
        order: n,
        marks: 2,
        negativeMarks: 0.5,
        status: 'ACTIVE' as const,
      })),
    );
  }

  /** The failure this prevents: a generated test a student can be offered but never open. */
  it('serves one of the papers, whole, rather than refusing to serve any', async () => {
    const prisma = new FakeTestsPrisma(
      [sittable({ paperBinding: PAPER_BINDING.GENERATED, variantCount: 2 })],
      [makeBaseConfig({ id: 'cfg_1', durationSec: 3600, totalQuestions: 3 })],
      SECTIONS,
      [],
      [],
      [],
      variants(),
      [],
      [],
      [],
    );
    const service = new AttemptsService(prisma.asService(), resolver());

    const attempt = await service.start(STUDENT, 'tst_1', {});

    assert.equal(attempt.startedByThisCall, true);
    const served = prisma.attemptQuestions.map((row) => row.questionId);
    assert.equal(served.length, 3);
    // Every question came from ONE of the two papers, never a blend of both.
    const from = new Set(served.map((id) => id.slice(0, 2)));
    assert.equal(from.size, 1);
  });
});
