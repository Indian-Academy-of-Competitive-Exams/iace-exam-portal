// Every paper edit starts here, for the one thing nothing else is left holding: the Test lock.
// It is the whole app's lock order — Test before Question — and the other side of it is the
// version rewrite in questions.service, which reaches Test through question_version_sat_guard.
// Unconditional, because an INSERT into PaperQuestion takes its FK parents in the order the
// statement leaves in, and two admins on one unfrozen test deadlocked when the orders disagreed.
import { Prisma } from '@prisma/client';

export async function beginPaperEdit(tx: Prisma.TransactionClient, testId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
}
