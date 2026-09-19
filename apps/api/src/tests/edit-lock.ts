// The test's key bound to the shared advisory lock in `common/edit-lock` — no logic of its own.

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { EDIT_SUBJECTS, editLockHeldBy, takeEditLock, type Editor } from '../common/edit-lock';

export type { Editor };

export const takeTestEditLock = (
  redis: RedisService,
  prisma: PrismaService,
  testId: string,
  editor: Editor,
): Promise<void> =>
  takeEditLock(redis, prisma, redisKeys.testEditLock(testId), EDIT_SUBJECTS.TEST, editor);

export const testEditingBy = (redis: RedisService, prisma: PrismaService, testId: string) =>
  editLockHeldBy(redis, prisma, redisKeys.testEditLock(testId));
