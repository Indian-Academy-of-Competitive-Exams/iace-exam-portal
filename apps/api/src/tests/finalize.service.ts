import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  scopedSections,
  TEST_STATUS,
  type OfferResult,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { unreadBySection } from '../assignments';
import { paperCompletenessIssues, scopeRefOf } from './test-rules';

const OFFER_SELECT = {
  id: true,
  baseConfigId: true,
  finalizedAt: true,
  status: true,
  version: true,
  testSeriesId: true,
  scope: true,
  scopeRef: true,
} as const satisfies Prisma.TestSelect;

type OfferRow = Prisma.TestGetPayload<{ select: typeof OFFER_SELECT }>;

/** Prisma's 5s default is a cliff nobody sees, so the freeze names its own. */
const FREEZE_LIMITS = { maxWait: 10_000, timeout: 15_000 } as const;

const RACED_MESSAGE = 'Another change landed on this test while it was being offered. Try again.';

const PAPER_REF_SELECT = {
  questionId: true,
  baseConfigSectionId: true,
} as const satisfies Prisma.PaperQuestionSelect;

type PaperRowRef = Prisma.PaperQuestionGetPayload<{ select: typeof PAPER_REF_SELECT }>;

/** Offers a test: the paper rows already exist, so this freezes them rather than writing them. */
@Injectable()
export class FinalizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  /** The freeze and the opening are ONE call: a failure between them offered a test to nobody. */
  async offer(testId: string, isSuperAdmin = false): Promise<OfferResult> {
    const test = await this.requireTest(testId);
    await this.assertAssignmentsRead(testId, isSuperAdmin);

    const offered = test.finalizedAt === null ? await this.freeze(test) : await this.reopen(test);

    // The series carrying it: the catalog a student reads is cached against it.
    this.events.emit(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED, { testSeriesId: test.testSeriesId });
    return offered;
  }

  /** The first offer, and the only one that freezes anything or counts a question's use. */
  private async freeze(test: OfferRow): Promise<OfferResult> {
    const finalizedAt = new Date();
    const frozen = await this.prisma.$transaction(async (tx) => {
      // The one gate: the request whose `version` still matches wins, the other writes nothing.
      const claimed = await tx.test.updateMany({
        where: { id: test.id, version: test.version, finalizedAt: null },
        // The status rides the SAME claim, so the two can never land apart.
        data: {
          finalizedAt,
          status: TEST_STATUS.ACTIVE,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      // Behind the gate: a paper counted outside it can be redrawn before the freeze.
      const paper = await this.paperOf(tx, test);
      // Throwing here rolls the claim back, so a paper that is not whole leaves the test a draft.
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

    if (frozen === null) return this.reopen(await this.requireTest(test.id));

    return {
      testId: test.id,
      finalizedAt: finalizedAt.toISOString(),
      finalizedByThisCall: true,
      frozenQuestions: frozen,
      status: TEST_STATUS.ACTIVE,
    };
  }

  /** Offered before: the paper never moved after that, so only the status can still change. */
  private async reopen(test: OfferRow): Promise<OfferResult> {
    if (test.finalizedAt === null) throw new AppException(ErrorCodes.CONFLICT, RACED_MESSAGE);

    if (test.status !== TEST_STATUS.ACTIVE) {
      await this.prisma.test.update({
        where: { id: test.id },
        data: { status: TEST_STATUS.ACTIVE },
      });
    }

    return {
      testId: test.id,
      finalizedAt: test.finalizedAt.toISOString(),
      finalizedByThisCall: false,
      frozenQuestions: await this.prisma.paperQuestion.count({ where: { testId: test.id } }),
      status: TEST_STATUS.ACTIVE,
    };
  }

  /** Every row the test holds, which is the whole of its one paper. */
  private async paperOf(tx: Prisma.TransactionClient, test: OfferRow): Promise<PaperRowRef[]> {
    return tx.paperQuestion.findMany({
      where: { testId: test.id },
      select: PAPER_REF_SELECT,
    });
  }

  private async assertPaperIsWhole(
    tx: Prisma.TransactionClient,
    test: OfferRow,
    paper: readonly PaperRowRef[],
  ): Promise<void> {
    const sections = await tx.baseConfigSection.findMany({
      where: { baseConfigId: test.baseConfigId },
      select: { id: true, name: true, questionCount: true, moduleId: true },
      orderBy: { order: 'asc' },
    });
    const scoped = scopedSections(sections, test.scope, scopeRefOf(test));

    const issues = paperCompletenessIssues(
      scoped,
      paper.map((row) => row.baseConfigSectionId),
    );
    const [first] = issues;
    if (first === undefined) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, first, {
      fieldErrors: { [FORM_LEVEL_FIELD]: issues },
    });
  }

  /** A section still being typed or read is not ready for a student to sit. No rows, no gate. */
  private async assertAssignmentsRead(testId: string, isSuperAdmin: boolean): Promise<void> {
    if (isSuperAdmin) return;

    const outstanding = await this.prisma.questionAssignment.findMany({
      where: { testId, finalizedAt: null },
      select: { baseConfigSection: { select: { name: true } } },
    });
    if (outstanding.length > 0) {
      const names = [...new Set(outstanding.map((row) => row.baseConfigSection.name))];
      const message = `${names.length} section${names.length === 1 ? ' is' : 's are'} still being proof-read: ${names.join(', ')}`;
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { [FORM_LEVEL_FIELD]: [message] },
      });
    }

    await this.assertPaperWasRead(testId);
  }

  /** Finalized is not the same as covering the paper — the paper can change after the reading. */
  private async assertPaperWasRead(testId: string): Promise<void> {
    const unread = await unreadBySection(this.prisma, testId);
    if (unread.size === 0) return;

    const sections = await this.prisma.baseConfigSection.findMany({
      where: { id: { in: [...unread.keys()] } },
      select: { id: true, name: true },
    });
    const issues = sections.map((section) => {
      const count = unread.get(section.id) ?? 0;
      return `${section.name} has ${count} question${count === 1 ? '' : 's'} on the paper that its proof-reader has not seen.`;
    });
    const [first] = issues;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, first ?? '', {
      fieldErrors: { [FORM_LEVEL_FIELD]: issues },
    });
  }

  private async requireTest(id: string): Promise<OfferRow> {
    const test = await this.prisma.test.findUnique({ where: { id }, select: OFFER_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    return test;
  }
}
