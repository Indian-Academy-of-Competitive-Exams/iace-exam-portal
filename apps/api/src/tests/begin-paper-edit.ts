// Every paper edit starts here, for the one thing nothing else is left holding: the Test lock.
// It is the whole app's lock order — Test before Question — and the other side of it is the
// version rewrite in questions.service, which reaches Test through question_version_sat_guard.
// Unconditional, because an INSERT into PaperQuestion takes its FK parents in the order the
// statement leaves in, and two admins on one unfrozen test deadlocked when the orders disagreed.
import { Prisma } from '@prisma/client';
import { AppException, ErrorCodes, FORM_LEVEL_FIELD } from '@iace/contracts';
import { OFFERED_TEST_MESSAGE } from './test-rules';

export async function beginPaperEdit(tx: Prisma.TransactionClient, testId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
}

/** A draft's paper edit: an offer may have landed since the caller checked, so it is read again under the lock. */
export async function beginDraftPaperEdit(
  tx: Prisma.TransactionClient,
  testId: string,
): Promise<void> {
  const [test] = await tx.$queryRaw<{ offered: boolean }[]>`
    SELECT "finalizedAt" IS NOT NULL AS offered FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
  if (!test?.offered) return;
  throw new AppException(ErrorCodes.CONFLICT, OFFERED_TEST_MESSAGE, {
    fieldErrors: { [FORM_LEVEL_FIELD]: [OFFERED_TEST_MESSAGE] },
  });
}
