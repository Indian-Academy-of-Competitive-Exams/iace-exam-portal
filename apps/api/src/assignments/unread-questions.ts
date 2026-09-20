import { ASSIGNMENT_ROLES } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** What a finalized reading did NOT cover, defined once for the gate and the counts alike. */

/** Per section of one test, how many of its paper questions the reading did not cover. */
export async function unreadBySection(
  prisma: PrismaService,
  testId: string,
): Promise<Map<string, number>> {
  const readings = await prisma.questionAssignment.findMany({
    where: { testId, role: ASSIGNMENT_ROLES.PROOFREADER, finalizedAt: { not: null } },
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
    select: {
      baseConfigSectionId: true,
      createdAt: true,
      question: { select: { releasedAt: true } },
    },
  });

  const unread = new Map<string, number>();
  for (const row of rows) {
    const read = readAt.get(row.baseConfigSectionId);
    if (!read || covered(row, read)) continue;
    unread.set(row.baseConfigSectionId, (unread.get(row.baseConfigSectionId) ?? 0) + 1);
  }
  return unread;
}

/** Either way it reached the reader: handed over before the reading, or on the paper before it. */
function covered(
  row: { createdAt: Date; question: { releasedAt: Date | null } },
  readAt: Date,
): boolean {
  if (row.createdAt <= readAt) return true;
  const released = row.question.releasedAt;
  return released !== null && released <= readAt;
}
