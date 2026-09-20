import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionOnOtherTest,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { takeSectionEditLock } from '../common/edit-lock';
import { reachableTest } from './question-query';
import { QuestionsService } from './questions.service';

/** The one section a proof-reader reads and fixes (docs/03 §5). */
@Injectable()
export class ProofreadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly questions: QuestionsService,
  ) {}

  /** The section this reader was handed: what its typist wrote, and what the paper picked into it. */
  async forAssignment(
    assignmentId: string,
    adminId: string,
    isSuperAdmin = false,
  ): Promise<QuestionDetail[]> {
    const assignment = await this.requireOwnSection(assignmentId, adminId, isSuperAdmin);
    return this.questions.allIn(sectionScope(assignment, isSuperAdmin));
  }

  /** One question of that section, for the screen that edits it — the list is not the authority, this is. */
  async oneFor(
    assignmentId: string,
    questionId: string,
    adminId: string,
    isSuperAdmin = false,
  ): Promise<QuestionDetail> {
    const assignment = await this.requireOwnSection(assignmentId, adminId, isSuperAdmin);
    await this.requireInSection(assignment, questionId, isSuperAdmin);
    return this.questions.detail(questionId);
  }

  /** The same question, reached by the section's own pair rather than by an assignment id. */
  async oneInSection(
    testId: string,
    baseConfigSectionId: string,
    questionId: string,
  ): Promise<QuestionDetail> {
    const section = await this.requireSection(testId, baseConfigSectionId);
    await this.requireInSection(section, questionId, true);
    return this.questions.detail(questionId);
  }

  /** The same section reached by its own pair, so a section nobody holds still opens for a super admin. */
  async forSection(testId: string, baseConfigSectionId: string): Promise<QuestionDetail[]> {
    return this.questions.allIn(
      sectionScope(await this.requireSection(testId, baseConfigSectionId), true),
    );
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
    return this.editIn(assignment, questionId, draft, adminId, isSuperAdmin);
  }

  /** The same edit, reached by the section's own pair rather than by an assignment id. */
  async editSectionQuestion(
    testId: string,
    baseConfigSectionId: string,
    questionId: string,
    draft: QuestionDraft,
    adminId: string,
  ): Promise<QuestionDetail> {
    const section = await this.requireSection(testId, baseConfigSectionId);
    return this.editIn(section, questionId, draft, adminId, true);
  }

  private async editIn(
    section: SectionRef,
    questionId: string,
    draft: QuestionDraft,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<QuestionDetail> {
    // Finalising ends a reader's authority over the section; it never ends a super admin's.
    if (section.finalizedAt && !isSuperAdmin) throw alreadyRead();
    await takeSectionEditLock(this.redis, this.prisma, section, { id: adminId, isSuperAdmin });

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, ...sectionScope(section, isSuperAdmin) },
      select: { status: true },
    });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');

    // Reading a section is no licence to retire out of it: the status stays the one it arrived with.
    return this.questions.update(questionId, { ...draft, status: question.status }, adminId);
  }

  /** Which other tests keep the old version — asked before the edit, not reported after it. */
  async otherTests(
    assignmentId: string,
    questionId: string,
    adminId: string,
    isSuperAdmin = false,
  ): Promise<QuestionOnOtherTest[]> {
    const assignment = await this.requireOwnSection(assignmentId, adminId, isSuperAdmin);
    return this.otherTestsIn(assignment, questionId, isSuperAdmin);
  }

  /** The same warning, for the section a super admin opened without an assignment behind it. */
  async sectionOtherTests(
    testId: string,
    baseConfigSectionId: string,
    questionId: string,
  ): Promise<QuestionOnOtherTest[]> {
    const section = await this.requireSection(testId, baseConfigSectionId);
    return this.otherTestsIn(section, questionId, true);
  }

  private async otherTestsIn(
    assignment: SectionRef,
    questionId: string,
    unreleasedToo: boolean,
  ): Promise<QuestionOnOtherTest[]> {
    await this.requireInSection(assignment, questionId, unreleasedToo);

    const rows = await this.prisma.paperQuestion.findMany({
      where: { questionId, testId: { not: assignment.testId } },
      select: {
        baseConfigSection: { select: { name: true } },
        test: {
          select: {
            id: true,
            title: true,
            opensAt: true,
            assignments: { select: { finalizedAt: true } },
          },
        },
      },
      orderBy: { test: { opensAt: 'asc' } },
    });
    if (rows.length === 0) return [];

    // The same predicate the version rule turns on, so the warning and the rewrite cannot disagree.
    const open = await this.prisma.test.findMany({
      where: { id: { in: rows.map((row) => row.test.id) }, ...reachableTest(new Date()) },
      select: { id: true },
    });
    const opened = new Set(open.map((row) => row.id));

    return rows.map((row) => ({
      testId: row.test.id,
      testTitle: row.test.title,
      sectionName: row.baseConfigSection.name,
      underReview: row.test.assignments.some((each) => each.finalizedAt === null),
      isOpen: opened.has(row.test.id),
      opensAt: row.test.opensAt?.toISOString() ?? null,
    }));
  }

  /** The same scope the edit rests on: a section is no licence to read the bank through it. */
  private async requireInSection(
    assignment: SectionRef,
    questionId: string,
    unreleasedToo: boolean,
  ): Promise<void> {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, ...sectionScope(assignment, unreleasedToo) },
      select: { id: true },
    });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
  }

  /** The same scope from the other key: the section exists on the test, and the reader is one if any. */
  private async requireSection(testId: string, baseConfigSectionId: string): Promise<SectionRef> {
    const section = await this.prisma.baseConfigSection.findFirst({
      where: { id: baseConfigSectionId, baseConfig: { tests: { some: { id: testId } } } },
      select: { id: true },
    });
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, 'No such section');

    const reading = await this.prisma.questionAssignment.findUnique({
      where: {
        testId_baseConfigSectionId_role: {
          testId,
          baseConfigSectionId,
          role: ASSIGNMENT_ROLES.PROOFREADER,
        },
      },
      select: { finalizedAt: true },
    });
    return { testId, baseConfigSectionId, finalizedAt: reading?.finalizedAt ?? null };
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
const sectionScope = (section: SectionRef, unreleasedToo: boolean): Prisma.QuestionWhereInput => {
  const { testId, baseConfigSectionId } = section;
  return {
    OR: [
      // A picked question has no typist and so nothing to wait for; only authored work is handed over.
      {
        assignment: { testId, baseConfigSectionId },
        ...(unreleasedToo ? {} : { releasedAt: { not: null } }),
      },
      { paperQuestions: { some: { testId, baseConfigSectionId } } },
    ],
  };
};
