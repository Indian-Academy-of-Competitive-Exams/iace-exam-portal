import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CreateSectionCommentBody,
  type SectionComment,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

const COMMENT_INCLUDE = {
  author: { select: { fullName: true, email: true, role: true } },
} as const satisfies Prisma.SectionCommentInclude;

type CommentRow = Prisma.SectionCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

const NOT_YOURS_TO_WRITE = 'Only this section’s typist and proof-reader can add to its thread.';

/** The discussion on one (test, section) — spec §9. Both assignees and a super admin write; everyone reads. */
@Injectable()
export class SectionThreadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Oldest first: a discussion is read in the order it was said, never paged. */
  async forSection(testId: string, baseConfigSectionId: string): Promise<SectionComment[]> {
    const rows = await this.prisma.sectionComment.findMany({
      where: { testId, baseConfigSectionId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toComment);
  }

  async comment(
    testId: string,
    baseConfigSectionId: string,
    body: CreateSectionCommentBody,
    authorId: string,
    isSuperAdmin = false,
  ): Promise<SectionComment> {
    await this.assertMayWrite(testId, baseConfigSectionId, authorId, isSuperAdmin);

    const row = await this.prisma.sectionComment.create({
      data: { testId, baseConfigSectionId, authorId, body: body.body },
      include: COMMENT_INCLUDE,
    });
    return toComment(row);
  }

  /** An assignment row on the pair is both the authority and the proof that the pair is real. */
  private async assertMayWrite(
    testId: string,
    baseConfigSectionId: string,
    authorId: string,
    isSuperAdmin: boolean,
  ): Promise<void> {
    const assignments = await this.prisma.questionAssignment.findMany({
      where: { testId, baseConfigSectionId },
      select: { assigneeId: true },
    });
    if (assignments.some((row) => row.assigneeId === authorId)) return;
    if (!isSuperAdmin) throw new AppException(ErrorCodes.FORBIDDEN, NOT_YOURS_TO_WRITE);

    await this.requireSection(testId, baseConfigSectionId);
  }

  /** Only a super admin can reach an unstaffed section, so only they need the pair checked. */
  private async requireSection(testId: string, baseConfigSectionId: string): Promise<void> {
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: { baseConfigId: true },
    });
    const section = test
      ? await this.prisma.baseConfigSection.findFirst({
          where: { id: baseConfigSectionId, baseConfigId: test.baseConfigId },
          select: { id: true },
        })
      : null;
    if (!section) throw new AppException(ErrorCodes.NOT_FOUND, 'No such section');
  }
}

function toComment(row: CommentRow): SectionComment {
  return {
    id: row.id,
    testId: row.testId,
    baseConfigSectionId: row.baseConfigSectionId,
    authorId: row.authorId,
    authorName: row.author.fullName ?? row.author.email,
    authorRole: row.author.role,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
