import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  TEST_STATUS,
  type OfferResult,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { ALREADY_FINALIZED_MESSAGE, paperCompletenessIssues } from './test-rules';

const FINALIZE_SELECT = {
  id: true,
  baseConfigId: true,
  isLocked: true,
  status: true,
  version: true,
  testSeriesId: true,
} as const satisfies Prisma.TestSelect;

type FinalizeRow = Prisma.TestGetPayload<{ select: typeof FINALIZE_SELECT }>;

/** Prisma's 5s default is a cliff nobody sees, so the freeze names its own. */
const FREEZE_LIMITS = { maxWait: 10_000, timeout: 15_000 } as const;

interface PaperRowRef {
  questionId: string;
  baseConfigSectionId: string;
}

export interface FinalizeResult {
  testId: string;
  finalizedAt: string;
  /** False when another request had already finalized it — the same outcome, not an error. */
  finalizedByThisCall: boolean;
  frozenQuestions: number;
}

/** Freezes a test: the draft rows already exist, so this locks them rather than writing them. */
@Injectable()
export class FinalizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  /** One transaction: as two calls, a failure between them froze a test and offered it to nobody. */
  async offer(testId: string): Promise<OfferResult> {
    const test = await this.requireTest(testId);

    const frozen = test.isLocked
      ? await this.openAlreadyFrozen(test)
      : { ...(await this.finalize(testId, TEST_STATUS.ACTIVE)), status: TEST_STATUS.ACTIVE };

    // The series carrying it: the catalog a student reads is cached against it.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
    return frozen;
  }

  /** Offering a retired test again: the paper never moved, so only its status does. */
  private async openAlreadyFrozen(test: FinalizeRow): Promise<OfferResult> {
    if (test.status !== TEST_STATUS.ACTIVE) {
      await this.prisma.test.update({
        where: { id: test.id },
        data: { status: TEST_STATUS.ACTIVE },
      });
    }
    return { ...(await this.alreadyFinalized(test)), status: TEST_STATUS.ACTIVE };
  }

  async finalize(testId: string, opening?: TestStatus): Promise<FinalizeResult> {
    const test = await this.requireTest(testId);
    if (test.isLocked) return this.alreadyFinalized(test);

    const finalizedAt = new Date();
    const frozen = await this.prisma.$transaction(async (tx) => {
      // The one gate: the request whose `version` still matches wins, the other writes nothing.
      const claimed = await tx.test.updateMany({
        where: { id: test.id, version: test.version, isLocked: false },
        // The status rides the SAME claim, so the two can never land apart.
        data: {
          isLocked: true,
          finalizedAt,
          version: { increment: 1 },
          ...(opening ? { status: opening } : {}),
        },
      });
      if (claimed.count === 0) return null;

      // Behind the gate: a paper counted outside it can be redrawn before the freeze.
      const paper = await this.paperOf(tx, test);
      // Throwing here rolls the claim back, so a paper that is not whole leaves the test unlocked.
      await this.assertPaperIsWhole(tx, test, paper);

      const served = [...new Set(paper.map((row) => row.questionId))];
      if (served.length > 0) {
        await tx.question.updateMany({
          where: { id: { in: served } },
          data: { fixedUseCount: { increment: 1 } },
        });
      }
      return paper.length;
    }, FREEZE_LIMITS);

    if (frozen === null) return this.alreadyFinalized(await this.requireTest(testId));

    return {
      testId: test.id,
      finalizedAt: finalizedAt.toISOString(),
      finalizedByThisCall: true,
      frozenQuestions: frozen,
    };
  }

  /** Every row the test holds, which is the whole of its one paper. */
  private async paperOf(tx: Prisma.TransactionClient, test: FinalizeRow): Promise<PaperRowRef[]> {
    return tx.paperQuestion.findMany({
      where: { testId: test.id },
      select: { questionId: true, baseConfigSectionId: true },
    });
  }

  private async assertPaperIsWhole(
    tx: Prisma.TransactionClient,
    test: FinalizeRow,
    paper: readonly PaperRowRef[],
  ): Promise<void> {
    const sections = await tx.baseConfigSection.findMany({
      where: { baseConfigId: test.baseConfigId },
      select: { id: true, name: true, questionCount: true },
      orderBy: { order: 'asc' },
    });

    const issues = paperCompletenessIssues(
      sections,
      paper.map((row) => row.baseConfigSectionId),
    );
    const [first] = issues;
    if (first === undefined) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, first, {
      fieldErrors: { [FORM_LEVEL_FIELD]: issues },
    });
  }

  private async alreadyFinalized(test: FinalizeRow): Promise<FinalizeResult> {
    const row = await this.prisma.test.findUnique({
      where: { id: test.id },
      select: { finalizedAt: true, _count: { select: { paperQuestions: true } } },
    });
    if (!row?.finalizedAt) {
      throw new AppException(ErrorCodes.CONFLICT, ALREADY_FINALIZED_MESSAGE);
    }
    return {
      testId: test.id,
      finalizedAt: row.finalizedAt.toISOString(),
      finalizedByThisCall: false,
      frozenQuestions: row._count.paperQuestions,
    };
  }

  private async requireTest(id: string): Promise<FinalizeRow> {
    const test = await this.prisma.test.findUnique({ where: { id }, select: FINALIZE_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}
