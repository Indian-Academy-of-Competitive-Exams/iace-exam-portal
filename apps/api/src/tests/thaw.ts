import { Prisma } from '@prisma/client';
import { unfreezing } from './test-rules';

/** Undoing a finalize, including the `fixedUseCount` it added — or a refreeze counts twice. */
export async function thaw(
  tx: Prisma.TransactionClient,
  test: { id: string; isLocked: boolean },
): Promise<void> {
  if (!test.isLocked) return;

  const paper = await tx.paperQuestion.findMany({
    where: { testId: test.id },
    select: { questionId: true },
  });

  await tx.test.update({ where: { id: test.id }, data: unfreezing(test) });

  if (paper.length === 0) return;
  await tx.question.updateMany({
    // Guarded, so a count that never got its increment cannot be driven below zero.
    where: { id: { in: paper.map((row) => row.questionId) }, fixedUseCount: { gt: 0 } },
    data: { fixedUseCount: { decrement: 1 } },
  });
}
