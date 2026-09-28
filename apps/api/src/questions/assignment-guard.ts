import { ASSIGNMENT_ROLES, AppException, ErrorCodes } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** The pair a section lock keys on — a question outside an assignment has none. */
export interface SectionRef {
  testId: string;
  baseConfigSectionId: string;
}

const SECTION_HANDED_OVER_MESSAGE =
  'You have marked this section done. New questions go to the bank, not this paper.';
const SECTION_READ_MESSAGE =
  'This section has been read, so its questions are no longer yours to change.';

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
      testId: true,
      baseConfigSectionId: true,
    },
  });
  if (row?.role !== ASSIGNMENT_ROLES.TYPIST || (row.assigneeId !== adminId && !isSuperAdmin)) {
    throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
  }
  if (row.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, SECTION_HANDED_OVER_MESSAGE);
  return { testId: row.testId, baseConfigSectionId: row.baseConfigSectionId };
}

/** A typist fixes what they wrote until the reader is done with it, and not after. */
export async function assertNotRead(prisma: PrismaService, section: SectionRef): Promise<void> {
  const read = await prisma.questionAssignment.count({
    where: { ...section, role: ASSIGNMENT_ROLES.PROOFREADER, finalizedAt: { not: null } },
  });
  if (read > 0) throw new AppException(ErrorCodes.CONFLICT, SECTION_READ_MESSAGE);
}
