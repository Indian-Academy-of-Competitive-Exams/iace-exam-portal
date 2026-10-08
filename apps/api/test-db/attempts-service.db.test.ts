import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  PRESENT_GRACE_SEC,
  TEST_SCOPE,
  TEST_STATUS,
  type LanguageMode,
  type TestScope,
  type TestStatus,
} from '@iace/contracts';
import type { AccessResolverService } from '../src/access';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptsService } from '../src/attempts/attempts.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { AuditContext } from '../src/audit';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakeRedis } from '../test/support/fakes';
import {
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
  uid,
  type Paper,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

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

interface Hall {
  status?: TestStatus;
  offered?: boolean;
  shuffleQuestions?: boolean;
  languageMode?: LanguageMode;
  languages?: (typeof LANGUAGE_CODE)[keyof typeof LANGUAGE_CODE][];
  locked?: boolean;
  permitted?: boolean;
  /** Questions per section, in section order; three in one section when left out. */
  sections?: readonly number[];
}

/** An offered test on an hour-long config — the only kind that can be sat — and a student. */
async function hall(over: Hall = {}) {
  const shape = over.sections ?? [3];
  const paper = await makePaper(prisma, {
    sections: shape.map((_, at) => `Section ${at + 1}`),
    questions: shape.flatMap((count, section) =>
      Array.from({ length: count }, () => ({ subject: 'Reasoning', section })),
    ),
  });
  for (const [at, questionCount] of shape.entries()) {
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[at] ?? '' },
      data: { questionCount },
    });
  }
  await prisma.baseConfig.update({
    where: { id: paper.catalog.baseConfigId },
    data: {
      durationSec: 3600,
      totalQuestions: paper.items.length,
      shuffleQuestions: over.shuffleQuestions ?? false,
      languageMode: over.languageMode ?? LANGUAGE_MODE.SINGLE,
      languages: over.languages ?? [LANGUAGE_CODE.EN],
    },
  });
  await prisma.test.update({
    where: { id: paper.testId },
    data: {
      status: over.status ?? TEST_STATUS.ACTIVE,
      finalizedAt: (over.offered ?? true) ? new Date() : null,
    },
  });
  if (over.locked) {
    await prisma.baseConfig.update({
      where: { id: paper.catalog.baseConfigId },
      data: { locked: true },
    });
  }
  const student = (await makeStudent(prisma)).id;
  const redis = new FakeRedis();
  const service = (client: PrismaService = prisma) =>
    new AttemptsService(
      client,
      resolver(over.permitted),
      new AttemptStateService(client, redis.asService(), new PaperSheetService(client)),
      new AttemptSheetService(client, new PaperSheetService(client)),
    );
  return { paper, student, redis, service: service(), serviceOn: service };
}

const served = (attemptId: string) => servedAnswers(prisma, attemptId);

const configOf = (paper: Paper) =>
  prisma.baseConfig.findUniqueOrThrow({ where: { id: paper.catalog.baseConfigId } });

const sittingsOf = (paper: Paper) => prisma.attempt.count({ where: { testId: paper.testId } });

/** A sitting already under way, as a start before this one would have left it. */
const running = (paper: Paper, studentId: string) =>
  sitPaper(prisma, {
    paper,
    studentId,
    chosen: paper.items.map(() => null),
    status: ATTEMPT_STATUS.IN_PROGRESS,
    submittedAt: null,
    startedAt: new Date(),
  });

describe('AttemptsService — starting a sitting', () => {
  it('gives the student a clock the SERVER set', async () => {
    const { service, student, paper } = await hall();

    const attempt = await service.start(student, paper.testId, {});

    // The request said nothing about timing, and the deadline is the config's duration past the start.
    assert.equal(Date.parse(attempt.endsAt) - Date.parse(attempt.startedAt), 3600 * 1000);
    assert.equal(attempt.status, ATTEMPT_STATUS.IN_PROGRESS);
    assert.equal(attempt.startedByThisCall, true);
  });

  it('seeds an untouched sheet with one slot per paper question', async () => {
    const { service, student, paper } = await hall();

    const attempt = await service.start(student, paper.testId, {});

    assert.equal(attempt.totalQuestions, 3);
    assert.deepEqual(
      (await served(attempt.id)).map((row) => [row.questionId, row.questionVersionId, row.state]),
      paper.items.map((item) => [item.questionId, item.versionId, ANSWER_STATE.NOT_VISITED]),
    );
    assert.deepEqual(
      (await prisma.attemptSheet.findUniqueOrThrow({ where: { attemptId: attempt.id } })).answers,
      [null, null, null],
    );
  });

  it('shuffles within a section but never across one', async () => {
    const { service, student, paper } = await hall({ sections: [3, 3], shuffleQuestions: true });

    const attempt = await service.start(student, paper.testId, {});

    // Section tabs would be meaningless if one section's questions interleaved with another's.
    const rows = await served(attempt.id);
    const [first, second] = paper.sectionIds;
    assert.deepEqual(
      rows.map((row) => row.baseConfigSectionId),
      [first, first, first, second, second, second],
    );
  });

  it('leaves the paper’s order alone when the config says not to shuffle', async () => {
    const { service, student, paper } = await hall({ shuffleQuestions: false });

    const attempt = await service.start(student, paper.testId, {});

    assert.deepEqual(
      (await served(attempt.id)).map((row) => row.questionId),
      paper.items.map((item) => item.questionId),
    );
  });

  /** WHICH sitting counts, never how many: the first ranks and a retake does not. */
  it('marks the first sitting graded, and a later one not', async () => {
    const { service, student, paper } = await hall();

    const first = await service.start(student, paper.testId, {});
    assert.deepEqual([first.attemptNo, first.isGraded], [1, true]);

    await prisma.attempt.update({
      where: { id: first.id },
      data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: new Date() },
    });

    // The cohort rollup fires on one attempt per student, so a retake must not carry it.
    const second = await service.start(student, paper.testId, {});
    assert.deepEqual([second.attemptNo, second.isGraded], [2, false]);
  });

  it('sits a SINGLE paper in the language the student picked', async () => {
    const { service, student, paper } = await hall({
      languageMode: LANGUAGE_MODE.SINGLE,
      languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
    });

    const attempt = await service.start(student, paper.testId, { languages: [LANGUAGE_CODE.HI] });

    assert.deepEqual(attempt.languages, [LANGUAGE_CODE.HI]);
  });

  it('sits a DUAL paper in both, whatever was asked for', async () => {
    const { service, student, paper } = await hall({
      languageMode: LANGUAGE_MODE.DUAL,
      languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
    });

    // DUAL renders both with no toggle, so the pick is not the student's to make.
    const attempt = await service.start(student, paper.testId, { languages: [LANGUAGE_CODE.EN] });

    assert.deepEqual(attempt.languages, [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI]);
  });
});

describe('AttemptsService — starting twice', () => {
  it('resumes the running sitting rather than starting a second', async () => {
    const { service, student, paper } = await hall();

    const first = await service.start(student, paper.testId, {});
    const again = await service.start(student, paper.testId, {});

    // The failure this prevents: a student refreshing the tab and getting a brand new clock.
    assert.equal(again.id, first.id);
    assert.equal(again.endsAt, first.endsAt);
    assert.equal(again.startedByThisCall, false);
    assert.equal(await sittingsOf(paper), 1);
  });

  it('resolves two concurrent starts to one sitting', async () => {
    const { service, student, paper } = await hall();

    const [a, b] = await Promise.all([
      service.start(student, paper.testId, {}),
      service.start(student, paper.testId, {}),
    ]);

    assert.equal(a.id, b.id);
    assert.equal(await sittingsOf(paper), 1);
    assert.equal(await prisma.attemptSheet.count(), 1);
  });

  /** No cap exists any more: a student may sit a paper as often as they like, ranked or not. */
  it('lets a ranked paper be sat again however many sittings are behind it', async () => {
    const { service, student, paper } = await hall();
    for (const attemptNo of [1, 2, 3]) {
      await sitPaper(prisma, {
        paper,
        studentId: student,
        chosen: [],
        attemptNo,
        isGraded: attemptNo === 1,
      });
    }

    const next = await service.start(student, paper.testId, {});

    assert.equal(next.attemptNo, 4);
    assert.equal(next.isGraded, false, 'and still only the first one ever ranked');
  });
});

describe('AttemptsService — what cannot be sat', () => {
  it('refuses a test that is not being offered', async () => {
    const { service, student, paper } = await hall({ status: TEST_STATUS.DRAFT });

    await assert.rejects(
      () => service.start(student, paper.testId, {}),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('refuses a test whose paper is not frozen', async () => {
    const { service, student, paper } = await hall({ offered: false });

    await assert.rejects(() => service.start(student, paper.testId, {}), /not been offered/);
  });

  /** The bug this prevents: an id nobody may sit answering differently from an id that is not a test. */
  it('refuses an id that is no test at all exactly as it refuses one out of reach', async () => {
    const { service, student } = await hall({ permitted: false });

    await assert.rejects(
      () => service.start(student, uid(), {}),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
      'a missing test must not be distinguishable from one the student cannot reach',
    );
  });

  it('lets the resolver refuse a student who cannot reach it, and writes nothing', async () => {
    const { service, student, paper } = await hall({ permitted: false });

    await assert.rejects(
      () => service.start(student, paper.testId, {}),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
    assert.equal(await sittingsOf(paper), 0);
  });
});

describe('AttemptsService — one sitting at a time, on one sign-in', () => {
  /** The failure this prevents: a second device starting another paper, its clock running, under the one being written. */
  it('refuses the other sign-in a different test while one is being answered, and starts nothing', async () => {
    const { service, student, paper } = await hall();
    const another = await hall();
    await service.start(student, paper.testId, { tab: 'tab_web' }, 'web');

    await assert.rejects(
      () => service.start(student, another.paper.testId, { tab: 'tab_app' }, 'app'),
      (error: unknown) =>
        AppException.is(error) && error.code === ErrorCodes.SITTING_HELD_ELSEWHERE,
    );
    assert.equal(await sittingsOf(another.paper), 0);
  });

  it('lets the same sign-in open a different test, as it always could', async () => {
    const { service, student, paper } = await hall();
    const another = await hall();
    await service.start(student, paper.testId, { tab: 'tab_one' }, 'web');

    await service.start(student, another.paper.testId, { tab: 'tab_two' }, 'web');

    assert.equal(await sittingsOf(another.paper), 1);
  });
});

describe('AttemptsService — resuming what is already running', () => {
  it('resumes a sitting the window has since closed under', async () => {
    const { service, student, paper } = await hall({ permitted: false });
    const live = await running(paper, student);

    const resumed = await service.start(student, paper.testId, {});

    // The failure this prevents: a reload after the window closes, locking a student out mid-paper.
    assert.equal(resumed.id, live.id);
    assert.equal(resumed.startedByThisCall, false);
  });

  it('resumes a sitting on a test that has since been retired', async () => {
    const { service, student, paper } = await hall({ status: TEST_STATUS.INACTIVE });
    const live = await running(paper, student);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: live.id } });

    const resumed = await service.start(student, paper.testId, {});

    assert.equal(resumed.id, live.id);
    assert.equal(resumed.endsAt, row.endsAt.toISOString());
  });
});

describe('AttemptsService — a reclaim names its sitting', () => {
  /** The failure this prevents: Continue here, after a hand-in elsewhere, opening a blank paper. */
  it('refuses to resume a sitting already handed in, and starts no other', async () => {
    const { service, student, paper } = await hall();
    const handedIn = await sitPaper(prisma, { paper, studentId: student, chosen: [] });

    await assert.rejects(
      () => service.start(student, paper.testId, { resume: handedIn.id }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.SITTING_ENDED,
    );
    assert.equal(await sittingsOf(paper), 1);
  });

  it('resumes the running sitting it names', async () => {
    const { service, student, paper } = await hall();
    const live = await running(paper, student);

    const resumed = await service.start(student, paper.testId, { resume: live.id });

    assert.equal(resumed.id, live.id);
    assert.equal(resumed.startedByThisCall, false);
    assert.equal(await sittingsOf(paper), 1);
  });
});

describe('AttemptsService — the blueprint stops moving', () => {
  /** The failure this prevents: a config edited to a different shape under a paper being sat. */
  it('locks the config when the first student starts', async () => {
    const { service, student, paper } = await hall();
    assert.equal((await configOf(paper)).locked, false);

    await service.start(student, paper.testId, {});

    assert.equal((await configOf(paper)).locked, true);
  });

  /** Every student on one test shares one config row, so a write per start would serialise them. */
  it('writes nothing once the config is already locked', async () => {
    const { serviceOn, student, paper } = await hall({ locked: true });
    let writes = 0;
    const counting = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== '$transaction') return Reflect.get(target, key) as unknown;
        return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction((tx) =>
            work(
              new Proxy(tx, {
                get(inner, model: string | symbol) {
                  if (model !== 'baseConfig') return Reflect.get(inner, model) as unknown;
                  writes += 1;
                  return inner.baseConfig;
                },
              }),
            ),
          );
      },
    });

    await serviceOn(counting).start(student, paper.testId, {});

    assert.equal(writes, 0);
    assert.equal((await configOf(paper)).locked, true);
  });

  /** A resume is not a start, and a sitting already under way has locked it long since. */
  it('leaves the config alone when the sitting is only being resumed', async () => {
    const { service, student, paper } = await hall();
    await running(paper, student);

    await service.start(student, paper.testId, {});

    assert.equal((await configOf(paper)).locked, false);
  });
});

describe('AttemptsService — a scoped test is sat on its own clock', () => {
  /** A fifteen-minute section of three and a forty-five-minute one of two, on an hour-long config. */
  async function sittingFor(scope: TestScope) {
    const built = await hall({ sections: [3, 2] });
    const [first, second] = built.paper.sectionIds;
    for (const [id, durationSec] of [
      [first, 900],
      [second, 2700],
    ] as const) {
      await prisma.baseConfigSection.update({ where: { id }, data: { durationSec } });
    }
    await prisma.test.update({
      where: { id: built.paper.testId },
      data: {
        scope,
        scopeRef: scope === TEST_SCOPE.SECTIONAL ? { sectionId: first ?? '' } : undefined,
      },
    });
    return built.service.start(built.student, built.paper.testId, {});
  }

  /** THE failure this prevents: a fifteen-minute section sat for the whole paper's hour. */
  it('ends a sectional sitting on the clock that section carries, counting its questions alone', async () => {
    const attempt = await sittingFor(TEST_SCOPE.SECTIONAL);

    assert.equal(Date.parse(attempt.endsAt) - Date.parse(attempt.startedAt), 900 * 1000);
    assert.equal(attempt.durationSec, 900);
    assert.equal(attempt.totalQuestions, 3);
  });

  /** A whole paper is untouched: its clock is still the configuration's, section times or not. */
  it('leaves a full paper on the configuration clock', async () => {
    const attempt = await sittingFor(TEST_SCOPE.FULL);

    assert.equal(Date.parse(attempt.endsAt) - Date.parse(attempt.startedAt), 3600 * 1000);
    assert.equal(attempt.totalQuestions, 5);
  });
});

describe('AttemptsService — a reload racing another move of the deadline', () => {
  const MINUTE_MS = 60 * 1000;
  const SILENT_MS = 10 * MINUTE_MS;
  const GRACE_MS = PRESENT_GRACE_SEC * 1000;

  /** A running sitting last heard from `silentMs` ago, and the support console over the same live key. */
  async function reloading(silentMs: number) {
    const built = await hall();
    const state = new AttemptStateService(
      prisma,
      built.redis.asService(),
      new PaperSheetService(prisma),
    );
    const { id } = await running(built.paper, built.student);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id } });
    await state.open(row, 'tab_a', new Date(Date.now() - silentMs));
    const support = new AttemptResolutionService(
      prisma,
      state,
      {} as never,
      {} as never,
      {} as never,
      new AuditContext(),
    );
    const settled = async () => {
      const held = await state.read(id);
      const now = await prisma.attempt.findUniqueOrThrow({ where: { id } });
      return {
        row: now.endsAt.toISOString(),
        key: held?.endsAt,
        gained: now.endsAt.getTime() - row.endsAt.getTime(),
        banked: held?.creditedMs ?? 0,
      };
    };
    return { ...built, id, support, settled };
  }

  /** The real client, with `meanwhile` landing once, right after the start has read the student's sittings. */
  function afterTheSittingsAreRead(meanwhile: () => Promise<unknown>): PrismaService {
    let pending = true;
    return new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== 'attempt') return Reflect.get(target, key) as unknown;
        return new Proxy(target.attempt, {
          get(delegate, method: string | symbol) {
            if (method !== 'findMany') return Reflect.get(delegate, method) as unknown;
            return async (args: Prisma.AttemptFindManyArgs) => {
              const rows = await delegate.findMany(args);
              if (pending) {
                pending = false;
                await meanwhile();
              }
              return rows;
            };
          },
        });
      },
    });
  }

  for (const [title, silentMs] of [
    ['a reload inside the grace', 0],
    ['a reload that earns pause credit', SILENT_MS],
  ] as const) {
    /** The failure this prevents: the reload writing back the deadline it read, over the minutes just given. */
    it(`keeps an extension that lands during ${title}`, async () => {
      const { student, paper, id, support, settled, serviceOn } = await reloading(silentMs);
      const racing = serviceOn(
        afterTheSittingsAreRead(() => support.extend(id, { minutes: 15, reason: 'Power cut' })),
      );

      const resumed = await racing.start(student, paper.testId, { tab: 'tab_a' });

      const { row, key, gained, banked } = await settled();
      assert.equal(key, row, 'the key admits saves until the deadline the sweeper judges by');
      assert.equal(resumed.endsAt, row);
      assert.equal(gained, 15 * MINUTE_MS + banked, 'the minutes and the credit both count');
      assert.equal(banked > 0, silentMs > 0);
    });
  }

  /** The real client, with `meanwhile` landing once, right before the resume adds its credit to the row. */
  function beforeTheRowIsCredited(meanwhile: () => Promise<unknown>): PrismaService {
    let pending = true;
    return new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== '$queryRaw') return Reflect.get(target, key) as unknown;
        return async (...args: unknown[]) => {
          if (pending) {
            pending = false;
            await meanwhile();
          }
          return (target.$queryRaw as (...values: unknown[]) => Promise<unknown>)(...args);
        };
      },
    });
  }

  /** The failure this prevents: the key left on its own credit while the row holds the credit and the minutes. */
  it('follows the row out when an extension lands between the credit to the key and to the row', async () => {
    const { student, paper, id, support, settled, serviceOn } = await reloading(SILENT_MS);
    const racing = serviceOn(
      beforeTheRowIsCredited(() => support.extend(id, { minutes: 15, reason: 'Power cut' })),
    );

    const resumed = await racing.start(student, paper.testId, { tab: 'tab_a' });

    const { row, key, gained, banked } = await settled();
    assert.equal(key, row);
    assert.equal(resumed.endsAt, row);
    assert.equal(gained, 15 * MINUTE_MS + banked);
  });

  /** The failure this prevents: the second reload lowering the key back to the deadline it read. */
  it('credits a pause once when two reloads land together', async () => {
    const { service, student, paper, settled } = await reloading(SILENT_MS);

    await Promise.all([
      service.start(student, paper.testId, { tab: 'tab_a' }),
      service.start(student, paper.testId, { tab: 'tab_a' }),
    ]);

    const { row, key, gained, banked } = await settled();
    assert.equal(key, row);
    assert.equal(gained, banked, 'the deadline moved by what was banked, once');
    assert.ok(banked >= SILENT_MS - GRACE_MS && banked < SILENT_MS, `banked ${banked}ms`);
  });
});
