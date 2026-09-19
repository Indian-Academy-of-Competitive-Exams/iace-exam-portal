import { Prisma } from '@prisma/client';
import { unfreezing } from './test-rules';

// Every paper edit starts here, and it does three things nothing else is left holding:
//   1. takes the Test lock, so the whole app orders Test before Question and cannot deadlock
//      against a question edit, which reaches Test through question_version_sat_guard;
//   2. thaws a frozen paper, because an edit invalidates the freeze it was finalized under;
//   3. gives back the fixedUseCount finalize added, or a refreeze would count every question twice.
// The lock is taken BEFORE the isLocked check: an unfrozen test still has to order with the rest.

export async function beginPaperEdit(
  tx: Prisma.TransactionClient,
  test: { id: string; isLocked: boolean },
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Test" WHERE "id" = ${test.id}::uuid FOR UPDATE`;
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
