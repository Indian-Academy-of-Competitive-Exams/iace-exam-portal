import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  EVALUATION_MODE,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  type LanguageCode,
  type LiveAttempt,
  type StartAttemptBody,
  scopedDurationSec,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { AttemptStateService } from './attempt-state.service';
import { isUniqueViolation } from '../common/prisma-errors';
import {
  deadlineFrom,
  displayOrder,
  languagesFor,
  retakeBlocker,
  testStartBlocker,
} from './attempt-rules';
import { sectionScoresIn } from './score-paper';

const SITTABLE_INCLUDE = {
  baseConfig: {
    select: {
      durationSec: true,
      languageMode: true,
      languages: true,
      totalQuestions: true,
      shuffleQuestions: true,
      locked: true,
      // A scoped test is sat on its own sections' clock, never the whole configuration's.
      sections: {
        select: {
          id: true,
          moduleId: true,
          questionCount: true,
          durationSec: true,
          perQuestionSec: true,
        },
      },
    },
  },
} as const satisfies Prisma.TestInclude;

/** The clock this test is actually sat on, which a scope narrows and the branch's extra time widens. */
function sittingSeconds(test: SittableTest): number {
  return scopedDurationSec(
    test.baseConfig.sections,
    test.baseConfig,
    test.scope,
    (test.scopeRef as TestScopeRef | null) ?? null,
  );
}

type SittableTest = Prisma.TestGetPayload<{ include: typeof SITTABLE_INCLUDE }>;

const LIVE = ATTEMPT_STATUS.IN_PROGRESS;

/** Which of the test's papers this sitting gets. A fixed test has one, so this is always 0. */
function variantFor(seed: number, variantCount: number): number {
  return variantCount > 1 ? seed % variantCount : 0;
}

/** Seeds are an Int on the row, and nothing here guards anything — it only has to be unpredictable. */
const SEED_CEILING = 2 ** 31;

/** Starting and resuming a sitting. The server owns the clock; the request never mentions it. */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly state: AttemptStateService,
  ) {}

  async start(studentId: string, testId: string, input: StartAttemptBody): Promise<LiveAttempt> {
    // Resume is not a start: the gate asks whether a sitting may BEGIN, and this one already has.
    const live = await this.liveAttempt(studentId, testId);
    if (live) {
      // A resume after the key expired rebuilds it, so answering never falls back to Postgres.
      await this.state.open(live);
      return toLiveAttempt(live, await this.requireTest(testId), false);
    }

    await this.access.assertCanStart(studentId, testId);

    const test = this.assertSittable(await this.requireTest(testId));

    const finished = await this.prisma.attempt.count({
      where: { testId, studentId, status: { not: LIVE } },
    });
    this.assertRetakeAllowed(test.maxRetakes, finished);
    const extraTimeSec = await this.access.extraTimeSecFor(studentId, testId);

    try {
      const started = await this.create(studentId, test, finished, input.languages, extraTimeSec);
      await this.state.open(started);
      // The catalog caches where this student has got to, and starting is one of two things that move it.
      await this.access.invalidateStudent(studentId);
      return toLiveAttempt(started, test, true);
    } catch (error) {
      // Two starts raced; the unique picked one. Read it back — they asked to sit, not to win.
      if (!isUniqueViolation(error)) throw error;
      const won = await this.liveAttempt(studentId, testId);
      if (!won) {
        throw new AppException(ErrorCodes.CONFLICT, 'That sitting has just ended. Open it again.');
      }
      await this.state.open(won);
      return toLiveAttempt(won, test, false);
    }
  }

  private async create(
    studentId: string,
    test: SittableTest,
    finished: number,
    picked: readonly LanguageCode[] | undefined,
    extraTimeSec: number,
  ) {
    const startedAt = new Date();
    const attemptNo = finished + 1;

    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          testId: test.id,
          studentId,
          attemptNo,
          // Counts toward a cohort: one attempt per student, the first, and never on a practice paper.
          isGraded: attemptNo === 1 && test.evaluationMode === EVALUATION_MODE.RANKED,
          startedAt,
          endsAt: deadlineFrom(startedAt, sittingSeconds(test) + extraTimeSec),
          shuffleSeed: randomInt(SEED_CEILING),
          languages: languagesFor(test.baseConfig.languageMode, test.baseConfig.languages, picked),
        },
      });

      // Read AFTER the seed exists, because the seed is what says which of the papers this is.
      const paper = await tx.paperQuestion.findMany({
        where: { testId: test.id, variant: variantFor(attempt.shuffleSeed, test.variantCount) },
        select: { id: true, questionId: true, questionVersionId: true, baseConfigSectionId: true },
        orderBy: { order: 'asc' },
      });
      const served = displayOrder(paper, attempt.shuffleSeed, test.baseConfig.shuffleQuestions);

      await tx.attemptQuestion.createMany({
        data: served.map((row, index) => ({
          attemptId: attempt.id,
          questionId: row.questionId,
          paperQuestionId: row.id,
          questionVersionId: row.questionVersionId,
          baseConfigSectionId: row.baseConfigSectionId,
          order: index + 1,
        })),
      });

      await this.lockTheBlueprint(tx, test);

      return attempt;
    });
  }

  /** A blueprint stops moving once somebody is sitting a paper drawn from it, and not before. */
  private async lockTheBlueprint(tx: Prisma.TransactionClient, test: SittableTest): Promise<void> {
    if (test.baseConfig.locked) return;
    await tx.baseConfig.updateMany({
      where: { id: test.baseConfigId, locked: false },
      data: { locked: true },
    });
  }

  private liveAttempt(studentId: string, testId: string) {
    return this.prisma.attempt.findFirst({
      where: { testId, studentId, status: LIVE },
      orderBy: { attemptNo: 'desc' },
    });
  }

  private assertRetakeAllowed(maxRetakes: number | null, finished: number): void {
    const blocker = retakeBlocker(maxRetakes, finished);
    if (blocker) {
      throw new AppException(ErrorCodes.CONFLICT, blocker, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [blocker] },
      });
    }
  }

  private async requireTest(testId: string): Promise<SittableTest> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      include: SITTABLE_INCLUDE,
    });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }

  private assertSittable(test: SittableTest): SittableTest {
    const blocker = testStartBlocker(test);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);
    return test;
  }
}

type AttemptRow = Prisma.AttemptGetPayload<object>;

function toLiveAttempt(
  attempt: AttemptRow,
  test: SittableTest,
  startedByThisCall: boolean,
): LiveAttempt {
  return {
    id: attempt.id,
    testId: attempt.testId,
    studentId: attempt.studentId,
    attemptNo: attempt.attemptNo,
    isGraded: attempt.isGraded,
    status: attempt.status,
    startedAt: attempt.startedAt.toISOString(),
    endsAt: attempt.endsAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    evaluatedAt: attempt.evaluatedAt?.toISOString() ?? null,
    shuffleSeed: attempt.shuffleSeed,
    languages: attempt.languages,
    score: attempt.score === null ? null : Number(attempt.score),
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unattemptedCount: attempt.unattemptedCount,
    sectionScores: sectionScoresIn(attempt.sectionScores),
    lastRank: attempt.lastRank,
    lastPercentile: attempt.lastPercentile === null ? null : Number(attempt.lastPercentile),
    createdAt: attempt.createdAt.toISOString(),
    startedByThisCall,
    testTitle: test.title,
    durationSec: sittingSeconds(test),
    totalQuestions: test.baseConfig.totalQuestions,
  };
}
