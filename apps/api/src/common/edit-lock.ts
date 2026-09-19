// One admin's advisory claim on one record, so two editing it minutes apart do not silently
// overwrite each other — the optimistic lock beside it only refuses the second save, after the work.
// TAKEN BEFORE THE TRANSACTION: Redis is not transactional with Postgres, so a claim taken inside
// one that then rolls back is a claim nobody released. There is no release and no heartbeat — it
// lapses 15 minutes after the last real edit, and a super admin stands a stale one down.

import { AppException, ErrorCodes, FORM_LEVEL_FIELD, type EditLockHolder } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EDIT_LOCK_TTL_SEC, redisKeys } from '../redis/redis.keys';

/** The caller of a mutation that edits a record. Without an id there is nobody to claim it for. */
export type Editor = { id?: string; isSuperAdmin?: boolean };

/** What a refusal calls the record, so it reads as the screen the admin is looking at. */
export const EDIT_SUBJECTS = {
  TEST: 'test',
  BASE_CONFIG: 'configuration',
  QUESTION: 'question',
  SECTION: 'section',
} as const;
export type EditSubject = (typeof EDIT_SUBJECTS)[keyof typeof EDIT_SUBJECTS];

const heldMessage = (fullName: string | null, subject: EditSubject): string =>
  `${fullName ?? 'Another admin'} is editing this ${subject}. Their changes have to land first.`;

/** Refuses when somebody else holds it; the holder and a super admin come back with 15 fresh minutes. */
export async function takeEditLock(
  redis: RedisService,
  prisma: PrismaService,
  key: string,
  subject: EditSubject,
  editor: Editor,
): Promise<void> {
  if (editor.id === undefined) return;

  const held = await redis.holdLock(
    key,
    editor.id,
    EDIT_LOCK_TTL_SEC,
    editor.isSuperAdmin ?? false,
  );
  if (held === null) return;

  const message = heldMessage(await fullNameOf(prisma, held), subject);
  throw new AppException(ErrorCodes.CONFLICT, message, {
    fieldErrors: { [FORM_LEVEL_FIELD]: [message] },
  });
}

/** Whoever holds it, named, so a screen warns before the work rather than at the save. */
export async function editLockHeldBy(
  redis: RedisService,
  prisma: PrismaService,
  key: string,
): Promise<EditLockHolder | null> {
  const adminId = await redis.getRaw(key);
  if (adminId === null) return null;
  return { adminId, fullName: await fullNameOf(prisma, adminId) };
}

/** Someone else moved the row between reading it and writing it; the save is not silently applied. */
export const editedElsewhere = (subject: EditSubject, field = FORM_LEVEL_FIELD) =>
  new AppException(
    ErrorCodes.CONFLICT,
    `Somebody else changed this ${subject} while you were working on it. Open it again.`,
    { fieldErrors: { [field]: [`This ${subject} changed while you were editing it`] } },
  );

async function fullNameOf(prisma: PrismaService, adminId: string): Promise<string | null> {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { fullName: true },
  });
  return admin?.fullName ?? null;
}

/** One key per (test, section): a typist and a reader write the same rows, so they cannot both hold it. */
export const takeSectionEditLock = (
  redis: RedisService,
  prisma: PrismaService,
  section: { testId: string; baseConfigSectionId: string },
  editor: Editor,
): Promise<void> =>
  takeEditLock(
    redis,
    prisma,
    redisKeys.sectionEditLock(section.testId, section.baseConfigSectionId),
    EDIT_SUBJECTS.SECTION,
    editor,
  );

export const sectionEditingBy = (
  redis: RedisService,
  prisma: PrismaService,
  section: { testId: string; baseConfigSectionId: string },
) =>
  editLockHeldBy(
    redis,
    prisma,
    redisKeys.sectionEditLock(section.testId, section.baseConfigSectionId),
  );
