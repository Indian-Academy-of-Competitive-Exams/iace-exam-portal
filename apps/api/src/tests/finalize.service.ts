import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  PAPER_SOURCES,
  scopedSections,
  TEST_STATUS,
} from '@iace/contracts';
import { uncheckedOn } from '../assignments';
import { paperCompletenessIssues } from './test-rules';
import { formRefusal } from '../common/form-refusal';
import { scopeRefOf } from '../common/prisma-json';

const OFFER_SELECT = {
  id: true,
  baseConfigId: true,
  finalizedAt: true,
  status: true,
  scope: true,
  scopeRef: true,
} as const satisfies Prisma.TestSelect;

type OfferRow = Prisma.TestGetPayload<{ select: typeof OFFER_SELECT }>;

const PAPER_REF_SELECT = {
  questionId: true,
  baseConfigSectionId: true,
} as const satisfies Prisma.PaperQuestionSelect;

type PaperRowRef = Prisma.PaperQuestionGetPayload<{ select: typeof PAPER_REF_SELECT }>;

type ReadingClient = Pick<Prisma.TransactionClient, 'questionAssignment' | 'paperQuestion'>;

/** Offers a test: the paper rows already exist, so this freezes them rather than writing them. */
@Injectable()
export class FinalizeService {
  /** Inside a transaction that already holds the Test row, so no paper edit can land between the gates and the freeze. */
  async offerWithin(
    tx: Prisma.TransactionClient,
    testId: string,
    isSuperAdmin: boolean,
  ): Promise<void> {
    const test = await tx.test.findUnique({ where: { id: testId }, select: OFFER_SELECT });
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
    await this.assertAssignmentsRead(tx, test.id, isSuperAdmin);

    if (test.finalizedAt !== null) {
      if (test.status !== TEST_STATUS.ACTIVE) {
        await tx.test.update({ where: { id: test.id }, data: { status: TEST_STATUS.ACTIVE } });
      }
      return;
    }

    await this.assertPaperIsWhole(tx, test, await this.paperOf(tx, test));
    const finalizedAt = new Date();
    // The status rides the SAME write, so the two can never land apart.
    await tx.test.update({
      where: { id: test.id },
      data: { finalizedAt, status: TEST_STATUS.ACTIVE, version: { increment: 1 } },
    });
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
  private async assertAssignmentsRead(
    db: ReadingClient,
    testId: string,
    isSuperAdmin: boolean,
  ): Promise<void> {
    if (isSuperAdmin) return;

    // A picked section's typist only fixes what comes back, so theirs is never a job to finish.
    const outstanding = await db.questionAssignment.findMany({
      where: {
        testId,
        finalizedAt: null,
        replacedAt: null,
        OR: [
          { role: ASSIGNMENT_ROLES.PROOFREADER },
          { role: ASSIGNMENT_ROLES.TYPIST, test: { paperSource: PAPER_SOURCES.FRAMED } },
        ],
      },
      select: { baseConfigSection: { select: { name: true } } },
    });
    if (outstanding.length > 0) {
      const names = [...new Set(outstanding.map((row) => row.baseConfigSection.name))];
      const message = `${names.length} section${names.length === 1 ? ' is' : 's are'} still being proof-read: ${names.join(', ')}`;
      throw formRefusal(ErrorCodes.VALIDATION_ERROR, message);
    }

    await this.assertPaperWasRead(db, testId);
  }

  /** Released is not the same as covering the paper: every question on a read section carries its reader's tick. */
  private async assertPaperWasRead(db: ReadingClient, testId: string): Promise<void> {
    const unchecked = await db.paperQuestion.findMany({
      where: {
        ...uncheckedOn(testId),
        baseConfigSection: {
          assignments: {
            some: { testId, role: ASSIGNMENT_ROLES.PROOFREADER, replacedAt: null },
          },
        },
      },
      select: { baseConfigSection: { select: { name: true } } },
    });
    const bySection = new Map<string, number>();
    for (const { baseConfigSection } of unchecked) {
      bySection.set(baseConfigSection.name, (bySection.get(baseConfigSection.name) ?? 0) + 1);
    }
    const issues = [...bySection].map(
      ([name, count]) =>
        `${name} has ${count} question${count === 1 ? '' : 's'} on the paper its proof-reader has not checked.`,
    );
    const [first] = issues;
    if (first === undefined) return;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, first, {
      fieldErrors: { [FORM_LEVEL_FIELD]: issues },
    });
  }
}
