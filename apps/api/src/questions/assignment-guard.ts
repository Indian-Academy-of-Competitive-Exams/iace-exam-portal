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
const SENT_BACK_ONLY_MESSAGE =
  'You have marked this section done, so only a question sent back to you can change now.';
const PASSED_ON_MESSAGE =
  'This section has passed to another typist, so its questions are no longer yours to change.';

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

/** Not once another typist holds the section; before Done they fix anything they wrote, after it only what was sent back. */
export async function assertTypistMayEdit(
  prisma: PrismaService,
  section: SectionRef,
  questionId: string,
  caller: { id: string; isSuperAdmin: boolean },
): Promise<void> {
  const typing = await prisma.questionAssignment.findFirst({
    where: { ...section, role: ASSIGNMENT_ROLES.TYPIST, replacedAt: null },
    select: { assigneeId: true, finalizedAt: true },
  });
  if (!caller.isSuperAdmin && typing && typing.assigneeId !== caller.id) {
    throw new AppException(ErrorCodes.FORBIDDEN, PASSED_ON_MESSAGE);
  }
  if (!typing?.finalizedAt) return;
  const sentBack = await prisma.questionReview.count({
    where: { testId: section.testId, questionId, sentBackAt: { not: null }, fixedAt: null },
  });
  if (sentBack === 0) throw new AppException(ErrorCodes.CONFLICT, SENT_BACK_ONLY_MESSAGE);
}
