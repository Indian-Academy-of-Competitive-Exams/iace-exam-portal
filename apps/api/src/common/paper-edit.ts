// The gates every paper edit passes, wherever it starts from — shared, because the first of them
// is the one thing nothing else is left holding: the Test lock.
// It is the whole app's lock order — Test before Question — and the other side of it is the
// version rewrite in questions.service, which reaches Test through question_version_sat_guard.
// Unconditional, because an INSERT into PaperQuestion takes its FK parents in the order the
// statement leaves in, and two admins on one unfrozen test deadlocked when the orders disagreed.
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '@iace/contracts';
import { formRefusal } from './form-refusal';

export const OFFERED_TEST_MESSAGE =
  'This test has been offered, so its paper is frozen and no longer moves. A question already on it can still be dropped or made a bonus.';

export const SOURCE_UNCHOSEN_MESSAGE =
  'Say where this test gets its questions before working on it.';

export async function beginPaperEdit(tx: Prisma.TransactionClient, testId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
}

/** A draft's paper edit: an offer may have landed since the caller checked, so it is read again under the lock. A caller whose screen is not the paper editor names its own refusal. */
export async function beginDraftPaperEdit(
  tx: Prisma.TransactionClient,
  testId: string,
  offeredMessage: string = OFFERED_TEST_MESSAGE,
): Promise<void> {
  const [test] = await tx.$queryRaw<{ offered: boolean }[]>`
    SELECT "finalizedAt" IS NOT NULL AS offered FROM "Test" WHERE "id" = ${testId}::uuid FOR UPDATE`;
  if (!test?.offered) return;
  throw formRefusal(ErrorCodes.CONFLICT, offeredMessage);
}

/** Picking IS choosing where questions come from, so every side of it waits on the decision — a super admin makes it, not skips it. */
export function assertSourceChosen<T extends { paperSource: string | null }>(
  test: T,
): asserts test is T & { paperSource: NonNullable<T['paperSource']> } {
  if (test.paperSource !== null) return;
  throw formRefusal(ErrorCodes.CONFLICT, SOURCE_UNCHOSEN_MESSAGE);
}
