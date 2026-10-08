import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type LanguageCode,
  type LiveAttempt,
  type StartAttemptBody,
  scopedDurationSec,
  scopedQuestionCount,
  languagesFor,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { AttemptStateService, type Resumed } from './attempt-state.service';
import { forwardOrderOf } from './attempt-state';
import { AttemptSheetService } from './attempt-sheet.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { scopeRefOf } from '../common/prisma-json';
import { deadlineFrom, slotsAfter, testStartBlocker, type SittingSlots } from './attempt-rules';
import { numberOrNull } from './attempt-report';
import { sectionScoresIn } from './score-paper';

const SITTABLE_INCLUDE = {
  baseConfig: {
    select: {
      durationSec: true,
      languageMode: true,
      languages: true,
      totalQuestions: true,
      locked: true,
      navigation: true,
      shuffleQuestions: true,
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

/** The clock this test is actually sat on: its sections' time, narrowed to what its scope covers. */
function sittingSeconds(test: SittableTest): number {
  return scopedDurationSec(test.baseConfig.sections, test.baseConfig, test.scope, scopeRefOf(test));
}

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
    private readonly state: AttemptStateService,
    private readonly sheets: AttemptSheetService,
  ) {}

  async start(
    studentId: string,
    testId: string,
    input: StartAttemptBody,
    session?: string,
  ): Promise<LiveAttempt> {
    // Independent of each other and wanted on both paths below, so they go in one wave, not two.
    const [sittings, found] = await Promise.all([
      // One read of their sittings serves both the resume below and the slot count after it.
      this.prisma.attempt.findMany({
        where: { testId, studentId },
        orderBy: { attemptNo: 'desc' },
      }),
      this.findTest(testId),
      // Whichever test is asked for: a sitting their other sign-in is answering is not set aside.
      this.state.assertFree(studentId, session),
    ]);
    // Resume is not a start: the gate asks whether a sitting may BEGIN, and this one already has.
    const live = sittings.find((row) => row.status === LIVE) ?? null;
    if (live && (input.resume === undefined || live.id === input.resume)) {
      const test = requireFound(found);
      // A lost key is rebuilt from Postgres before reopening, so a resume never blanks the sitting.
      const resumed = await this.state.resume(opened(live, test, session), input.tab);
      return toLiveAttempt({ ...live, endsAt: await this.credit(live.id, resumed) }, test, false);
    }
    // A reclaim of a sitting handed in elsewhere must land on its result, not on a fresh paper.
    if (input.resume !== undefined) throw new AppException(ErrorCodes.SITTING_ENDED);

    // Still the FIRST refusal, so a test that does not exist reads the same as one they cannot reach.
    await this.access.assertCanStart(studentId, testId);

    const test = this.assertSittable(requireFound(found));

    // Read, not counted: a paper may be sat any number of times, and the VOID ones still matter.
    const slots = slotsAfter(sittings.filter((row) => row.status !== LIVE));

    try {
      const started = await this.create(studentId, test, slots, input.languages);
      await this.state.open(opened(started, test, session), input.tab);
      return toLiveAttempt(started, test, true);
    } catch (error) {
      // Two starts raced; the unique picked one. Read it back — they asked to sit, not to win.
      if (!isUniqueViolation(error)) throw error;
      const won = await this.liveAttempt(studentId, testId);
      if (!won) {
        throw new AppException(ErrorCodes.CONFLICT, 'That sitting has just ended. Open it again.');
      }
      await this.state.open(opened(won, test, session), input.tab);
      return toLiveAttempt(won, test, false);
    }
  }

  /** Durable too, or the sweeper would judge a resumed sitting by the deadline it walked away from. */
  private async credit(attemptId: string, { endsAt, creditedMs }: Resumed): Promise<Date> {
    if (creditedMs === 0) return endsAt;
    // Added, never written back: an extension that landed since this start read the row still stands.
    const [row] = await this.prisma.$queryRaw<{ endsAt: Date }[]>`
      UPDATE "Attempt"
      SET "endsAt" = "endsAt" + ${creditedMs}::int * interval '1 millisecond', "updatedAt" = now()
      WHERE "id" = ${attemptId}::uuid AND "status" = ${LIVE}::"AttemptStatus"
      RETURNING "endsAt"`;
    if (!row || row.endsAt <= endsAt) return endsAt;
    // The row is the record: it holds a move the key has not seen, so the key follows it out.
    await this.state.pushDeadline(attemptId, row.endsAt);
    return row.endsAt;
  }

  private async create(
    studentId: string,
    test: SittableTest,
    slots: SittingSlots,
    picked: readonly LanguageCode[] | undefined,
  ) {
    const startedAt = new Date();
    // Read before the transaction opens: 6,000 starts must not each hold one open for a count.
    const size = await this.sheets.sizeOf(test.id);

    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({
        data: {
          testId: test.id,
          studentId,
          attemptNo: slots.attemptNo,
          // Counts toward a cohort: the one sitting holding the ranked slot.
          isGraded: slots.ranksAgain,
          startedAt,
          endsAt: deadlineFrom(startedAt, sittingSeconds(test)),
          shuffleSeed: randomInt(SEED_CEILING),
          languages: languagesFor(test.baseConfig.languageMode, test.baseConfig.languages, picked),
        },
      });

      await this.sheets.create(tx, attempt.id, size);

      await this.lockTheBlueprint(tx, test);

      return attempt;
    }, TX_LIMITS.SHORT);
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

  private findTest(testId: string): Promise<SittableTest | null> {
    return this.prisma.test.findUnique({ where: { id: testId }, include: SITTABLE_INCLUDE });
  }

  private assertSittable(test: SittableTest): SittableTest {
    const blocker = testStartBlocker(test);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);
    return test;
  }
}

/** Pure, so the read can be hoisted into the parallel wave while the refusal stays in its order. */
function requireFound(test: SittableTest | null): SittableTest {
  if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
  return test;
}

type AttemptRow = Prisma.AttemptGetPayload<object>;

function opened(attempt: AttemptRow, test: SittableTest, session?: string) {
  const { navigation, shuffleQuestions } = test.baseConfig;
  return {
    ...attempt,
    session,
    forwardOnly: forwardOrderOf(navigation, attempt.shuffleSeed, shuffleQuestions),
  };
}

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
    score: numberOrNull(attempt.score),
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unattemptedCount: attempt.unattemptedCount,
    sectionScores: sectionScoresIn(attempt.sectionScores),
    createdAt: attempt.createdAt.toISOString(),
    startedByThisCall,
    testTitle: test.title,
    durationSec: sittingSeconds(test),
    totalQuestions: scopedQuestionCount(test.baseConfig.sections, test.scope, scopeRefOf(test)),
  };
}
