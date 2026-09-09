/**
 * Owns `SavedQuestion` (docs/03 §5) — the two lists a student keeps of the bank. It READS the
 * sitting and the bank to gate a star and to draw a row; only the rollup fold writes beside it,
 * and that crossing is named in §5.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  SAVED_QUESTION_KIND,
  type BookmarkQuestionBody,
  type BookmarkedInAttempt,
  type LocalizedContent,
  type Paginated,
  type SavedListQuery,
  type SavedQuestion,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { stemPreviewOf } from '../questions';
import { isUniqueViolation } from '../common/prisma-errors';

const NOT_YOURS = 'No such saved question';
const NOT_SAT = 'You did not sit this question';
const NOT_REVIEWABLE = 'This sitting has not been marked yet';

/** Everything a row shows. `options` and `answerKey` are absent by design — see the file header. */
const ROW_SELECT = {
  id: true,
  questionId: true,
  kind: true,
  attemptId: true,
  createdAt: true,
  question: {
    select: {
      subject: { select: { name: true } },
      topic: { select: { name: true } },
      currentVersion: { select: { content: true } },
    },
  },
} as const satisfies Prisma.SavedQuestionSelect;

type SavedRow = Prisma.SavedQuestionGetPayload<{ select: typeof ROW_SELECT }>;

@Injectable()
export class SavedQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One list, newest first — the `(studentId, kind, createdAt)` index read straight through. */
  async list(studentId: string, query: SavedListQuery): Promise<Paginated<SavedQuestion>> {
    const where = { studentId, kind: query.kind };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.savedQuestion.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ROW_SELECT,
      }),
      this.prisma.savedQuestion.count({ where }),
    ]);

    return { items: rows.map(toSavedQuestion), page: query.page, pageSize: query.pageSize, total };
  }

  /** Idempotent by the unique guard: starring twice is one row, and returns the one already there. */
  async bookmark(studentId: string, input: BookmarkQuestionBody): Promise<SavedQuestion> {
    const served = await this.servedPastTheGate(studentId, input);

    try {
      await this.prisma.savedQuestion.create({
        data: {
          studentId,
          questionId: input.questionId,
          kind: SAVED_QUESTION_KIND.BOOKMARK,
          attemptId: input.attemptId,
          paperQuestionId: served.paperQuestionId,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const row = await this.prisma.savedQuestion.findUniqueOrThrow({
      where: {
        studentId_questionId_kind: {
          studentId,
          questionId: input.questionId,
          kind: SAVED_QUESTION_KIND.BOOKMARK,
        },
      },
      select: ROW_SELECT,
    });
    return toSavedQuestion(row);
  }

  /** Either list. The owner is part of the DELETE, so another student's row reads as missing. */
  async remove(studentId: string, id: string): Promise<void> {
    const dropped = await this.prisma.savedQuestion.deleteMany({ where: { id, studentId } });
    if (dropped.count === 0) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
  }

  /** Matched on the questions this sitting SERVED, so one starred in an earlier paper still shows. */
  async bookmarkedIn(studentId: string, attemptId: string): Promise<BookmarkedInAttempt> {
    const served = await this.prisma.attemptQuestion.findMany({
      where: { attemptId, attempt: { studentId } },
      select: { questionId: true },
    });
    if (served.length === 0) return { attemptId, bookmarks: [] };

    const rows = await this.prisma.savedQuestion.findMany({
      where: {
        studentId,
        kind: SAVED_QUESTION_KIND.BOOKMARK,
        questionId: { in: served.map((row) => row.questionId) },
      },
      select: { id: true, questionId: true },
    });
    return {
      attemptId,
      bookmarks: rows.map((row) => ({ questionId: row.questionId, savedId: row.id })),
    };
  }

  /** The star rides the review surface, which one EVALUATED sitting of their own is the key to. */
  private async servedPastTheGate(
    studentId: string,
    input: BookmarkQuestionBody,
  ): Promise<{ paperQuestionId: string | null }> {
    const served = await this.prisma.attemptQuestion.findFirst({
      where: {
        attemptId: input.attemptId,
        questionId: input.questionId,
        attempt: { studentId },
      },
      select: {
        paperQuestionId: true,
        attempt: {
          select: {
            testId: true,
            status: true,
            test: {
              select: { evaluationMode: true, baseConfig: { select: { durationSec: true } } },
            },
          },
        },
      },
    });
    if (!served) throw new AppException(ErrorCodes.NOT_FOUND, NOT_SAT);
    if (served.attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    return { paperQuestionId: served.paperQuestionId };
  }
}

function toSavedQuestion(row: SavedRow): SavedQuestion {
  return {
    id: row.id,
    questionId: row.questionId,
    kind: row.kind,
    stemPreview: stemPreviewOf((row.question.currentVersion?.content ?? {}) as LocalizedContent),
    subject: row.question.subject.name,
    topic: row.question.topic?.name ?? null,
    attemptId: row.attemptId,
    createdAt: row.createdAt.toISOString(),
  };
}
