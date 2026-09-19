import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  type QuestionDetail,
  type QuestionDraft,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from './questions.service';

/** The one section a proof-reader reads and fixes (docs/03 §5). */
@Injectable()
export class ProofreadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
  ) {}

  /** The section this reader was handed: what its typist wrote, and what the paper picked into it. */
  async forAssignment(
    assignmentId: string,
    adminId: string,
    isSuperAdmin = false,
  ): Promise<QuestionDetail[]> {
    const assignment = await this.requireOwnSection(assignmentId, adminId, isSuperAdmin);
    return this.questions.allIn(sectionScope(assignment));
  }

  /** The reader FIXES what they find, over the one service that owns the tables — never a second path. */
  async editQuestion(
    assignmentId: string,
    questionId: string,
    draft: QuestionDraft,
    adminId: string,
    isSuperAdmin = false,
  ): Promise<QuestionDetail> {
    const assignment = await this.requireOwnSection(assignmentId, adminId, isSuperAdmin);
    // Finalising ends a reader's authority over the section; it never ends a super admin's.
    if (assignment.finalizedAt && !isSuperAdmin) throw alreadyRead();

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, ...sectionScope(assignment) },
      select: { status: true },
    });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');

    // Reading a section is no licence to retire out of it: the status stays the one it arrived with.
    return this.questions.update(questionId, { ...draft, status: question.status }, adminId);
  }

  /** Not theirs reads as not there — unless a super admin, who is refused no section of their own institute. */
  private async requireOwnSection(
    assignmentId: string,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<SectionRef> {
    const row = await this.prisma.questionAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        testId: true,
        baseConfigSectionId: true,
        assigneeId: true,
        role: true,
        finalizedAt: true,
      },
    });
    const theirs = row?.assigneeId === adminId && row?.role === ASSIGNMENT_ROLES.PROOFREADER;
    if (!row || (!theirs && !isSuperAdmin)) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such assignment');
    }
    return row;
  }
}

const alreadyRead = () =>
  new AppException(
    ErrorCodes.CONFLICT,
    'You have marked this section read, so it is no longer yours to change.',
  );

interface SectionRef {
  testId: string;
  baseConfigSectionId: string;
  finalizedAt: Date | null;
}

/** Spec §7.1, held to the SECTION the assignment is: what was written for it, and what was picked into it. */
const sectionScope = (section: SectionRef): Prisma.QuestionWhereInput => {
  const { testId, baseConfigSectionId } = section;
  return {
    OR: [
      { assignment: { testId, baseConfigSectionId } },
      { paperQuestions: { some: { testId, baseConfigSectionId } } },
    ],
  };
};
