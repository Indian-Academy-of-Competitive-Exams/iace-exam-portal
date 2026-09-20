import { AppException, ErrorCodes } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** The pair a section lock keys on — a question outside an assignment has none. */
export interface SectionRef {
  testId: string;
  baseConfigSectionId: string;
}

/** Not theirs reads as not there — unless a super admin, who takes up a section nobody holds. */
export async function requireOwnAssignment(
  prisma: PrismaService,
  id: string,
  adminId: string,
  isSuperAdmin: boolean,
): Promise<SectionRef> {
  const row = await prisma.questionAssignment.findUnique({
    where: { id },
    select: { assigneeId: true, testId: true, baseConfigSectionId: true },
  });
  if (!row || (row.assigneeId !== adminId && !isSuperAdmin)) {
    throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
  }
  return row;
}
