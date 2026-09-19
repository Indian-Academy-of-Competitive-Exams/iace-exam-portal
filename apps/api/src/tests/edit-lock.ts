// One admin's advisory claim on a test, so two building its paper do not silently overwrite each
// other minutes apart — the row locks in `beginPaperEdit` only order writes that overlap in time.
// TAKEN BEFORE THE TRANSACTION: Redis is not transactional with Postgres, so a claim taken inside
// one that then rolls back is a claim nobody released. There is no release and no heartbeat — it
// lapses 15 minutes after the last real edit, and a super admin stands a stale one down.

import { AppException, ErrorCodes, FORM_LEVEL_FIELD, type TestEditor } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys, TEST_EDIT_LOCK_TTL_SEC } from '../redis/redis.keys';

/** The caller of a mutation that edits a paper. Without an id there is nobody to claim it for. */
export type Editor = { id?: string; isSuperAdmin?: boolean };

const heldMessage = (fullName: string | null): string =>
  `${fullName ?? 'Another admin'} is editing this test. Their changes have to land first.`;

/** Refuses when somebody else holds it; the holder and a super admin come back with 15 fresh minutes. */
export async function takeTestEditLock(
  redis: RedisService,
  prisma: PrismaService,
  testId: string,
  editor: Editor,
): Promise<void> {
  if (editor.id === undefined) return;

  const held = await redis.holdLock(
    redisKeys.testEditLock(testId),
    editor.id,
    TEST_EDIT_LOCK_TTL_SEC,
    editor.isSuperAdmin ?? false,
  );
  if (held === null) return;

  const message = heldMessage(await fullNameOf(prisma, held));
  throw new AppException(ErrorCodes.CONFLICT, message, {
    fieldErrors: { [FORM_LEVEL_FIELD]: [message] },
  });
}

/** Whoever holds it, named, so a screen warns before the work rather than at the save. */
export async function testEditingBy(
  redis: RedisService,
  prisma: PrismaService,
  testId: string,
): Promise<TestEditor | null> {
  const adminId = await redis.getRaw(redisKeys.testEditLock(testId));
  if (adminId === null) return null;
  return { adminId, fullName: await fullNameOf(prisma, adminId) };
}

async function fullNameOf(prisma: PrismaService, adminId: string): Promise<string | null> {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { fullName: true },
  });
  return admin?.fullName ?? null;
}
