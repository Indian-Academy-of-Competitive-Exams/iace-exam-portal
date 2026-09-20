import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CommentRevision,
  type CreateSectionCommentBody,
  type EditSectionCommentBody,
  type SectionComment,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const COMMENT_INCLUDE = {
  author: { select: { fullName: true, email: true, role: true } },
} as const satisfies Prisma.SectionCommentInclude;

type CommentRow = Prisma.SectionCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

const NOT_YOURS_TO_WRITE = 'Only this section’s typist and proof-reader can add to its thread.';
const NOT_YOURS_TO_REWORD = 'You can only reword what you wrote yourself.';

/** The same hour a question's images get: a thread stays open longer than one, so it re-reads. */
const IMAGE_URL_TTL_SEC = 3600;

/** The discussion on one (test, section) — spec §9. Both assignees and a super admin write; everyone reads. */
@Injectable()
export class SectionThreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Oldest first: a discussion is read in the order it was said, never paged. */
  async forSection(testId: string, baseConfigSectionId: string): Promise<SectionComment[]> {
    const rows = await this.prisma.sectionComment.findMany({
      where: { testId, baseConfigSectionId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return this.signedAll(rows);
  }

  async comment(
    testId: string,
    baseConfigSectionId: string,
    input: CreateSectionCommentBody,
    authorId: string,
    isSuperAdmin = false,
  ): Promise<SectionComment> {
    await this.assertMayWrite(testId, baseConfigSectionId, authorId, isSuperAdmin);

    const row = await this.prisma.sectionComment.create({
      data: { testId, baseConfigSectionId, authorId, body: input.body, images: input.images },
      include: COMMENT_INCLUDE,
    });
    return this.signed(row);
  }

  /** Its own author and nobody else — not a super admin, who would be putting words in a mouth. */
  async editComment(
    testId: string,
    baseConfigSectionId: string,
    commentId: string,
    input: EditSectionCommentBody,
    authorId: string,
  ): Promise<SectionComment> {
    const before = await this.prisma.sectionComment.findFirst({
      where: { id: commentId, testId, baseConfigSectionId },
      select: { authorId: true, body: true, createdAt: true, editedAt: true },
    });
    if (!before) throw new AppException(ErrorCodes.NOT_FOUND, 'No such comment');
    if (before.authorId !== authorId) {
      throw new AppException(ErrorCodes.FORBIDDEN, NOT_YOURS_TO_REWORD);
    }

    const replaced: CommentRevision = {
      body: before.body,
      at: (before.editedAt ?? before.createdAt).toISOString(),
    };
    const row = await this.prisma.sectionComment.update({
      where: { id: commentId },
      data: {
        body: input.body,
        editedAt: new Date(),
        revisions: { push: replaced as unknown as Prisma.InputJsonValue },
      },
      include: COMMENT_INCLUDE,
    });
    return this.signed(row);
  }

  private async signed(row: CommentRow): Promise<SectionComment> {
    const [only] = await this.signedAll([row]);
    return only ?? toComment(row, new Map());
  }

  /** One signing pass for the whole thread: fifty lines of pictures is not fifty round trips. */
  private async signedAll(rows: readonly CommentRow[]): Promise<SectionComment[]> {
    const keys = new Set(rows.flatMap((row) => row.images));
    const urls = new Map(
      await Promise.all(
        [...keys].map(
          async (key) =>
            [key, await this.storage.createDownloadUrl(key, IMAGE_URL_TTL_SEC)] as const,
        ),
      ),
    );
    return rows.map((row) => toComment(row, urls));
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

function toComment(row: CommentRow, urls: ReadonlyMap<string, string>): SectionComment {
  return {
    id: row.id,
    testId: row.testId,
    baseConfigSectionId: row.baseConfigSectionId,
    authorId: row.authorId,
    authorName: row.author.fullName ?? row.author.email,
    authorRole: row.author.role,
    body: row.body,
    images: row.images.flatMap((key) => {
      const url = urls.get(key);
      return url ? [url] : [];
    }),
    editedAt: row.editedAt?.toISOString() ?? null,
    revisions: row.revisions as unknown as CommentRevision[],
    createdAt: row.createdAt.toISOString(),
  };
}
