import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  TEST_STATUS,
  type OfferResult,
  type PaperBinding,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import {
  ALREADY_FINALIZED_MESSAGE,
  activationBlocker,
  paperCompletenessIssues,
} from './test-rules';
import { PaperService } from './paper.service';

const FINALIZE_SELECT = {
  id: true,
  baseConfigId: true,
  paperBinding: true,
  variantCount: true,
  isLocked: true,
  status: true,
  version: true,
  _count: { select: { series: true } },
} as const satisfies Prisma.TestSelect;

type FinalizeRow = Prisma.TestGetPayload<{ select: typeof FINALIZE_SELECT }>;

/** A 50-variant paper is thousands of rows, and the default 5s is a cliff nobody sees coming. */
const FREEZE_TIMEOUT_MS = 15_000;

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
    private readonly paper: PaperService,
    private readonly events: DomainEventBus,
  ) {}

  /** One transaction: as two calls, a failure between them froze a test and offered it to nobody. */
  async offer(testId: string): Promise<OfferResult> {
    const test = await this.requireTest(testId);
    this.assertOfferable(test);

    const frozen = test.isLocked
      ? await this.openAlreadyFrozen(test)
      : { ...(await this.finalize(testId, TEST_STATUS.ACTIVE)), status: TEST_STATUS.ACTIVE };

    // Every series carrying it: the catalog a student reads is cached against them.
    for (const link of await this.prisma.testSeriesTest.findMany({
      where: { testId },
      select: { testSeriesId: true },
    })) {
      this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: link.testSeriesId });
    }
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

  private assertOfferable(test: FinalizeRow): void {
    const blocker = activationBlocker({ isLocked: true, seriesCount: test._count.series });
    if (!blocker) return;
    throw new AppException(ErrorCodes.CONFLICT, blocker, {
      fieldErrors: { [FORM_LEVEL_FIELD]: [blocker] },
    });
  }

  async finalize(testId: string, opening?: TestStatus): Promise<FinalizeResult> {
    const test = await this.requireTest(testId);
    if (test.isLocked) return this.alreadyFinalized(test);

    // Drawn BEFORE the freeze, not per attempt: a pool query per student is the thing to avoid.
    const drawn = fixed(test.paperBinding)
      ? null
      : await this.paper.drawVariants(test.id, test.variantCount);

    const finalizedAt = new Date();
    const frozen = await this.prisma.$transaction(
      async (tx) => {
        // The one gate: the request whose `version` still matches wins, the other writes nothing.
        const claimed = await tx.test.updateMany({
          // The draw was made from these two, so a call that changed them must lose the freeze.
          where: {
            id: test.id,
            version: test.version,
            isLocked: false,
            paperBinding: test.paperBinding,
            variantCount: test.variantCount,
          },
          // The status rides the SAME claim, so the two can never land apart.
          data: {
            isLocked: true,
            finalizedAt,
            version: { increment: 1 },
            ...(opening ? { status: opening } : {}),
          },
        });
        if (claimed.count === 0) return null;

        // Written behind the gate: a draw that lost this race must not replace a frozen paper.
        if (drawn) await this.paper.writeVariants(tx, test.id, drawn);

        // Behind the gate: a paper counted outside it can be redrawn before the freeze.
        const paper = drawn ?? (await this.paperOf(tx, test));
        // Throwing here rolls the claim back, so a paper that is not whole leaves the test unlocked.
        if (fixed(test.paperBinding)) await this.assertPaperIsWhole(tx, test, paper);

        const served = [...new Set(paper.map((row) => row.questionId))];
        if (served.length > 0) {
          await tx.question.updateMany({
            where: { id: { in: served } },
            data: { fixedUseCount: { increment: 1 } },
          });
        }
        return paper.length;
      },
      { timeout: FREEZE_TIMEOUT_MS },
    );

    if (frozen === null) return this.alreadyFinalized(await this.requireTest(testId));

    return {
      testId: test.id,
      finalizedAt: finalizedAt.toISOString(),
      finalizedByThisCall: true,
      frozenQuestions: frozen,
    };
  }

  /** Every row the test holds. A GENERATED test has one paper per variant by the time this runs. */
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
    if (issues.length === 0) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, issues[0]!, {
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

const fixed = (binding: PaperBinding) => binding === PAPER_BINDING.FIXED;
