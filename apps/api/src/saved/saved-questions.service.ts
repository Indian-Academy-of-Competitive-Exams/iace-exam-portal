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
  type SavedQuestionKind,
  type SavedFacets,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { stemPreviewOf } from '../questions';
import { isUniqueViolation } from '../common/prisma-errors';

const NOT_YOURS = 'No such saved question';
const NOT_SAT = 'You did not sit this question';
const UNTITLED_TEST = 'Untitled test';
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
    const where: Prisma.SavedQuestionWhereInput = {
      studentId,
      kind: query.kind,
      // Undefined, never `in: []`: an empty choice means every subject, which Prisma reads as none.
      ...(query.subjectId?.length ? { question: { subjectId: { in: query.subjectId } } } : {}),
      // `attemptId` is a scalar, so a test narrows by the sittings it holds rather than by a join.
      ...(query.testId?.length
        ? { attemptId: { in: await this.attemptIdsOn(studentId, query.testId) } }
        : {}),
    };
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

    const sat = await this.satContext(rows);
    return {
      items: rows.map((row) => toSavedQuestion(row, sat.get(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** The sittings this student had on those tests. An empty answer narrows to nothing, correctly. */
  private async attemptIdsOn(studentId: string, testId: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { studentId, testId: { in: [...testId] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** The paper each row was met on and what it cost — two lookups, because `attemptId` is a scalar. */
  private async satContext(rows: readonly SavedRow[]): Promise<Map<string, SatContext>> {
    const attemptIds = [...new Set(rows.flatMap((row) => (row.attemptId ? [row.attemptId] : [])))];
    if (attemptIds.length === 0) return new Map();

    const [attempts, timings] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { id: { in: attemptIds } },
        select: { id: true, testId: true, test: { select: { title: true } } },
      }),
      this.prisma.attemptQuestion.findMany({
        where: {
          attemptId: { in: attemptIds },
          questionId: { in: [...new Set(rows.map((row) => row.questionId))] },
        },
        select: { attemptId: true, questionId: true, timeSpentSec: true },
      }),
    ]);

    const paper = new Map(attempts.map((row) => [row.id, row]));
    const spent = new Map(
      timings.map((row) => [`${row.attemptId}:${row.questionId}`, row.timeSpentSec]),
    );

    return new Map(
      rows.flatMap((row) => {
        const on = row.attemptId === null ? undefined : paper.get(row.attemptId);
        if (!on) return [];
        return [
          [
            row.id,
            {
              testId: on.testId,
              testTitle: on.test.title,
              timeSpentSec: spent.get(`${row.attemptId}:${row.questionId}`) ?? null,
            },
          ] as const,
        ];
      }),
    );
  }

  /** Read across the WHOLE saved set, not a page: a filter that shifts as you page is a trap. */
  async facets(studentId: string, kind: SavedQuestionKind): Promise<SavedFacets> {
    const rows = await this.prisma.savedQuestion.findMany({
      where: { studentId, kind },
      select: {
        attemptId: true,
        question: { select: { subject: { select: { id: true, name: true } } } },
      },
    });

    const subjects = new Map(
      rows.map((row) => [row.question.subject.id, row.question.subject.name]),
    );
    const attemptIds = [...new Set(rows.flatMap((row) => (row.attemptId ? [row.attemptId] : [])))];

    const attempts =
      attemptIds.length === 0
        ? []
        : await this.prisma.attempt.findMany({
            where: { id: { in: attemptIds } },
            select: { testId: true, test: { select: { title: true } } },
          });

    const tests = new Map(attempts.map((row) => [row.testId, row.test.title ?? UNTITLED_TEST]));
    return { subjects: named(subjects), tests: named(tests) };
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

interface SatContext {
  testId: string;
  testTitle: string | null;
  timeSpentSec: number | null;
}

/** A filter reads by name, so the map is turned into rows and sorted the way a reader scans. */
const named = (byId: ReadonlyMap<string, string>) =>
  [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

function toSavedQuestion(row: SavedRow, sat?: SatContext): SavedQuestion {
  return {
    id: row.id,
    questionId: row.questionId,
    kind: row.kind,
    stemPreview: stemPreviewOf((row.question.currentVersion?.content ?? {}) as LocalizedContent),
    subject: row.question.subject.name,
    topic: row.question.topic?.name ?? null,
    attemptId: row.attemptId,
    testId: sat?.testId ?? null,
    testTitle: sat?.testTitle ?? null,
    timeSpentSec: sat?.timeSpentSec ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
