import { type Prisma } from '@prisma/client';
import { type PrismaService } from '../prisma/prisma.service';

/** Who a student is on a report row: the columns an admin reads a person by. */
export const STUDENT_CARD_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  programs: true,
  currentBranch: { select: { name: true } },
} as const satisfies Prisma.StudentSelect;

export type StudentCard = Prisma.StudentGetPayload<{ select: typeof STUDENT_CARD_SELECT }>;

export function studentCardsOf(
  prisma: PrismaService,
  ids: readonly string[],
): Promise<StudentCard[]> {
  return prisma.student.findMany({ where: { id: { in: [...ids] } }, select: STUDENT_CARD_SELECT });
}
