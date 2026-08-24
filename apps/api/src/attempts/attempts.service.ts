import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  type LanguageCode,
  type LiveAttempt,
  type StartAttemptBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { isUniqueViolation } from '../common/prisma-errors';
import {
  deadlineFrom,
  displayOrder,
  languagesFor,
  retakeBlocker,
  testStartBlocker,
} from './attempt-rules';

const SITTABLE_INCLUDE = {
  baseConfig: {
    select: {
      durationSec: true,
      languageMode: true,
      languages: true,
      totalQuestions: true,
      shuffleQuestions: true,
    },
  },
  paperQuestions: {
    select: { id: true, questionId: true, questionVersionId: true, baseConfigSectionId: true },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.TestInclude;

type SittableTest = Prisma.TestGetPayload<{ include: typeof SITTABLE_INCLUDE }>;

const LIVE = ATTEMPT_STATUS.IN_PROGRESS;

/** Seeds are an Int on the row, and nothing here guards anything — it only has to be unpredictable. */
const SEED_CEILING = 2 ** 31;

/** Starting and resuming a sitting. The server owns the clock; the request never mentions it. */
@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
  ) {}

  async start(studentId: string, testId: string, input: StartAttemptBody): Promise<LiveAttempt> {
    // Resume is not a start: the gate asks whether a sitting may BEGIN, and this one already has.
    const live = await this.liveAttempt(studentId, testId);
    if (live) return toLiveAttempt(live, await this.requireTest(testId), false);

    await this.access.assertCanStart(studentId, testId);

    const test = this.assertSittable(await this.requireTest(testId));

    const finished = await this.prisma.attempt.count({
      where: { testId, studentId, status: { not: LIVE } },
    });
    this.assertRetakeAllowed(test.maxRetakes, finished);

    try {
      return toLiveAttempt(
        await this.create(studentId, test, finished, input.languages),
        test,
        true,
      );
    } catch (error) {
      // Two starts raced; the unique picked one. Read it back — they asked to sit, not to win.
      if (!isUniqueViolation(error)) throw error;
      const won = await this.liveAttempt(studentId, testId);
      if (!won) {
        throw new AppException(ErrorCodes.CONFLICT, 'That sitting has just ended. Open it again.');
      }
      return toLiveAttempt(won, test, false);
    }
  }

  private async create(
    studentId: string,
    test: SittableTest,
    finished: number,
    picked: readonly LanguageCode[] | undefined,
  ) {
    const startedAt = new Date();
    const attemptNo = finished + 1;

    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          testId: test.id,
          studentId,
          attemptNo,
          // The cohort rollup fires on one attempt per student, and it is the first.
          isGraded: attemptNo === 1,
          startedAt,
          endsAt: deadlineFrom(startedAt, test.baseConfig.durationSec),
          shuffleSeed: randomInt(SEED_CEILING),
          languages: languagesFor(test.baseConfig.languageMode, test.baseConfig.languages, picked),
        },
      });

      const served = displayOrder(
        test.paperQuestions,
        attempt.shuffleSeed,
        test.baseConfig.shuffleQuestions,
      );

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

      return attempt;
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
    lastRank: attempt.lastRank,
    lastPercentile: attempt.lastPercentile === null ? null : Number(attempt.lastPercentile),
    createdAt: attempt.createdAt.toISOString(),
    startedByThisCall,
    testTitle: test.title,
    durationSec: test.baseConfig.durationSec,
    totalQuestions: test.paperQuestions.length,
  };
}
