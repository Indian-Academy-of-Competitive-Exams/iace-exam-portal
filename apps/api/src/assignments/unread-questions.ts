import { type Prisma } from '@prisma/client';
import { ASSIGNMENT_ROLES } from '@iace/contracts';

/** A paper question its reader has not checked: one definition for release, the offer, and a later change. */
export function uncheckedOn(testId: string): Prisma.PaperQuestionWhereInput {
  return { testId, question: { reviews: { none: { testId, checkedAt: { not: null } } } } };
}

/** A whole section holding a question its released reader has not checked goes back to them, or nobody could offer it. */
export async function reopenReadingIfUnchecked(
  tx: Prisma.TransactionClient,
  testId: string,
  baseConfigSectionId: string,
): Promise<void> {
  const { questionCount } = await tx.baseConfigSection.findUniqueOrThrow({
    where: { id: baseConfigSectionId },
    select: { questionCount: true },
  });
  const onPaper = await tx.paperQuestion.count({ where: { testId, baseConfigSectionId } });
  // Short, it stays with the owner to finish: a reader can only release a whole section.
  if (onPaper < questionCount) return;

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

/** A reworded question loses its ticks on every draft, on the paper or off it, and a whole released section holding it goes back to its reader. */
export async function uncheckReworded(
  tx: Prisma.TransactionClient,
  questionId: string,
): Promise<void> {
  // Off the paper too: a question taken off and put back must not return under the old words' tick.
  await tx.questionReview.updateMany({
    where: { questionId, test: { finalizedAt: null }, checkedAt: { not: null } },
    data: { checkedAt: null, checkedById: null },
  });
  const onDrafts = await tx.paperQuestion.findMany({
    where: { questionId, test: { finalizedAt: null } },
    select: { testId: true, baseConfigSectionId: true },
  });
  for (const { testId, baseConfigSectionId } of onDrafts) {
    await reopenReadingIfUnchecked(tx, testId, baseConfigSectionId);
  }
}
