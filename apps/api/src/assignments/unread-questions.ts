import { type Prisma } from '@prisma/client';
import { ASSIGNMENT_ROLES } from '@iace/contracts';

/** A paper question its reader has not checked: one definition for release, the offer, and a later change. */
export function uncheckedOn(testId: string): Prisma.PaperQuestionWhereInput {
  return { testId, question: { reviews: { none: { testId, checkedAt: { not: null } } } } };
}

/** A paper change a released reader has not checked sends the section back to them, or nobody could offer it. */
export async function reopenReadingIfUnchecked(
  tx: Prisma.TransactionClient,
  testId: string,
  baseConfigSectionId: string,
): Promise<void> {
  const unchecked = await tx.paperQuestion.count({
    where: { ...uncheckedOn(testId), baseConfigSectionId },
  });
  if (unchecked === 0) return;
  await tx.questionAssignment.updateMany({
    where: {
      testId,
      baseConfigSectionId,
      role: ASSIGNMENT_ROLES.PROOFREADER,
      replacedAt: null,
      finalizedAt: { not: null },
    },
    data: { finalizedAt: null },
  });
}
