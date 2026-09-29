import { ASSIGNMENT_ROLES, AppException, ErrorCodes, PAPER_SOURCES } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** The pair a section lock keys on — a question outside an assignment has none. */
export interface SectionRef {
  testId: string;
  baseConfigSectionId: string;
}

const SECTION_HANDED_OVER_MESSAGE =
  'You have marked this section done. New questions go to the bank, not this paper.';
const NOTHING_TO_TYPE_MESSAGE =
  'This test is picked from the bank, so its sections are not typed. Fix what is sent back to you.';

/** A typing job the caller still holds open — unless a super admin, who takes up a section nobody holds. */
export async function requireOwnAssignment(
  prisma: PrismaService,
  id: string,
  adminId: string,
  isSuperAdmin: boolean,
): Promise<SectionRef> {
  const row = await prisma.questionAssignment.findUnique({
    where: { id },
    select: {
      assigneeId: true,
      role: true,
      finalizedAt: true,
      replacedAt: true,
      testId: true,
      baseConfigSectionId: true,
      test: { select: { paperSource: true } },
    },
  });
  const theirs = row?.assigneeId === adminId || isSuperAdmin;
  if (row?.role !== ASSIGNMENT_ROLES.TYPIST || row.replacedAt || !theirs) {
    throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
  }
  if (row.test.paperSource !== PAPER_SOURCES.FRAMED) {
    throw new AppException(ErrorCodes.CONFLICT, NOTHING_TO_TYPE_MESSAGE);
  }
  if (row.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, SECTION_HANDED_OVER_MESSAGE);
  return { testId: row.testId, baseConfigSectionId: row.baseConfigSectionId };
}
