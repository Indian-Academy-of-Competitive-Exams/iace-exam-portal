import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_BINDING,
  type PaperBinding,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ALREADY_FINALIZED_MESSAGE, paperCompletenessIssues } from './test-rules';

const FINALIZE_SELECT = {
  id: true,
  baseConfigId: true,
  paperBinding: true,
  isLocked: true,
  version: true,
} as const satisfies Prisma.TestSelect;

type FinalizeRow = Prisma.TestGetPayload<{ select: typeof FINALIZE_SELECT }>;

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
  constructor(private readonly prisma: PrismaService) {}

  async finalize(testId: string): Promise<FinalizeResult> {
    const test = await this.requireTest(testId);
    if (test.isLocked) return this.alreadyFinalized(test);

    const finalizedAt = new Date();
    const frozen = await this.prisma.$transaction(async (tx) => {
      // The one gate: the request whose `version` still matches wins, the other writes nothing.
      const claimed = await tx.test.updateMany({
        where: { id: test.id, version: test.version, isLocked: false },
        data: { isLocked: true, finalizedAt, version: { increment: 1 } },
      });
      if (claimed.count === 0) return null;

      // Behind the gate: a paper counted outside it can be redrawn before the freeze.
      const paper = await this.paperOf(tx, test);
      // Throwing here rolls the claim back, so a paper that is not whole leaves the test unlocked.
      if (fixed(test.paperBinding)) await this.assertPaperIsWhole(tx, test, paper);

      if (paper.length > 0) {
        await tx.question.updateMany({
          where: { id: { in: paper.map((row) => row.questionId) } },
          data: { fixedUseCount: { increment: 1 } },
        });
      }
      return paper.length;
    });

    if (frozen === null) return this.alreadyFinalized(await this.requireTest(testId));

    return {
      testId: test.id,
      finalizedAt: finalizedAt.toISOString(),
      finalizedByThisCall: true,
      frozenQuestions: frozen,
    };
  }

  /** A GENERATED test freezes its draw spec, not a paper: there are no rows to count. */
  private async paperOf(tx: Prisma.TransactionClient, test: FinalizeRow): Promise<PaperRowRef[]> {
    if (!fixed(test.paperBinding)) return [];
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
