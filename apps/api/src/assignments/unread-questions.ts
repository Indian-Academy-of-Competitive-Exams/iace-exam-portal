import { ASSIGNMENT_ROLES } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** What a finalized reading did NOT cover, defined once for the gate and the counts alike. */

/** Per section of one test, how many of its paper questions the reading did not cover. */
export async function unreadBySection(
  prisma: PrismaService,
  testId: string,
): Promise<Map<string, number>> {
  const readings = await prisma.questionAssignment.findMany({
    where: {
      testId,
      role: ASSIGNMENT_ROLES.PROOFREADER,
      finalizedAt: { not: null },
      replacedAt: null,
    },
    select: { baseConfigSectionId: true, finalizedAt: true },
  });
  if (readings.length === 0) return new Map();

  const readAt = new Map(
    readings.flatMap((row) =>
      row.finalizedAt ? [[row.baseConfigSectionId, row.finalizedAt]] : [],
    ),
  );

  const rows = await prisma.paperQuestion.findMany({
    where: { testId, baseConfigSectionId: { in: [...readAt.keys()] } },
    select: { baseConfigSectionId: true, createdAt: true },
  });

  const unread = new Map<string, number>();
  for (const row of rows) {
    const read = readAt.get(row.baseConfigSectionId);
    if (!read || row.createdAt <= read) continue;
    unread.set(row.baseConfigSectionId, (unread.get(row.baseConfigSectionId) ?? 0) + 1);
  }
  return unread;
}
