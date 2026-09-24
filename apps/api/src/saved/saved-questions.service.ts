/**
 * Owns `SavedQuestion` (docs/03 §5) — the questions a student starred in a review. It READS the
 * sitting and the bank to gate a star and to draw a row, and nothing else writes the table.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type BookmarkQuestionBody,
  type BookmarkedInAttempt,
  type LiveAnswer,
  type LocalizedContent,
  type Paginated,
  type SavedListQuery,
  type SavedQuestion,
  type SavedFacets,
} from '@iace/contracts';
import { answersOf } from '../attempts';
import { pageArgs, paged } from '../common/pagination';
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

  /** Newest first — the `(studentId, createdAt)` index read straight through. */
  async list(studentId: string, query: SavedListQuery): Promise<Paginated<SavedQuestion>> {
    const where: Prisma.SavedQuestionWhereInput = {
      studentId,
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
        ...pageArgs(query),
        select: ROW_SELECT,
      }),
      this.prisma.savedQuestion.count({ where }),
    ]);

    const sat = await this.satContext(rows);
    return paged(
      query,
      rows.map((row) => toSavedQuestion(row, sat.get(row.id))),
      total,
    );
  }

  /** The sittings this student had on those tests. An empty answer narrows to nothing, correctly. */
  private async attemptIdsOn(studentId: string, testId: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { studentId, testId: { in: [...testId] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** The paper each row was met on and what it cost — the sheet read once per sitting, not per row. */
  private async satContext(rows: readonly SavedRow[]): Promise<Map<string, SatContext>> {
    const attemptIds = [...new Set(rows.flatMap((row) => (row.attemptId ? [row.attemptId] : [])))];
    if (attemptIds.length === 0) return new Map();

    const attempts = await this.prisma.attempt.findMany({
      where: { id: { in: attemptIds } },
      select: {
        id: true,
        testId: true,
        startedAt: true,
        test: { select: { title: true } },
        sheet: { select: { answers: true } },
      },
    });
    const paperRows = await this.prisma.paperQuestion.findMany({
      where: { testId: { in: [...new Set(attempts.map((row) => row.testId))] } },
      orderBy: [{ testId: 'asc' }, { order: 'asc' }],
      select: { testId: true, questionId: true, optionIds: true },
    });
    const paper = new Map(attempts.map((row) => [row.id, row]));
    const spent = new Map(
      attempts.map((row) => {
        const rows = paperRows.filter((paperRow) => paperRow.testId === row.testId);
        return [
          row.id,
          {
            onPaper: new Set(rows.map((r) => r.questionId)),
            answers: answersOf(row.sheet?.answers, rows, row.startedAt),
          },
        ] as const;
      }),
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
              timeSpentSec: spentOn(spent.get(row.attemptId ?? ''), row.questionId),
            },
          ] as const,
        ];
      }),
    );
  }

  /** Read across the WHOLE saved set, not a page: a filter that shifts as you page is a trap. */
  async facets(studentId: string): Promise<SavedFacets> {
    const rows = await this.prisma.savedQuestion.findMany({
      where: { studentId },
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
          attemptId: input.attemptId,
          paperQuestionId: served.paperQuestionId,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const row = await this.prisma.savedQuestion.findUniqueOrThrow({
      where: { studentId_questionId: { studentId, questionId: input.questionId } },
      select: ROW_SELECT,
    });
    return toSavedQuestion(row);
  }

  /** The owner is part of the DELETE, so another student's row reads as missing. */
  async remove(studentId: string, id: string): Promise<void> {
    const dropped = await this.prisma.savedQuestion.deleteMany({ where: { id, studentId } });
    if (dropped.count === 0) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
  }

  /** Matched on the questions this sitting SERVED, so one starred in an earlier paper still shows. */
  async bookmarkedIn(studentId: string, attemptId: string): Promise<BookmarkedInAttempt> {
    const sitting = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: { testId: true },
    });
    const served =
      sitting === null
        ? []
        : await this.prisma.paperQuestion.findMany({
            where: { testId: sitting.testId },
            select: { questionId: true },
          });
    if (served.length === 0) return { attemptId, bookmarks: [] };

    const rows = await this.prisma.savedQuestion.findMany({
      where: { studentId, questionId: { in: served.map((row) => row.questionId) } },
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
    const sitting = await this.prisma.attempt.findFirst({
      where: { id: input.attemptId, studentId },
      select: { testId: true, status: true },
    });
    const served =
      sitting === null
        ? null
        : await this.prisma.paperQuestion.findUnique({
            where: { testId_questionId: { testId: sitting.testId, questionId: input.questionId } },
            select: { id: true },
          });
    if (!sitting || !served) throw new AppException(ErrorCodes.NOT_FOUND, NOT_SAT);
    if (sitting.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    return { paperQuestionId: served.id };
  }
}

interface SatContext {
  testId: string;
  testTitle: string | null;
  timeSpentSec: number | null;
}

/** A served question nobody touched spent nothing; one off the paper has no figure at all. */
function spentOn(
  sat: { onPaper: ReadonlySet<string>; answers: Readonly<Record<string, LiveAnswer>> } | undefined,
  questionId: string,
): number | null {
  if (!sat?.onPaper.has(questionId)) return null;
  return sat.answers[questionId]?.timeSpentSec ?? 0;
}

/** A filter reads by name, so the map is turned into rows and sorted the way a reader scans. */
const named = (byId: ReadonlyMap<string, string>) =>
  [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

function toSavedQuestion(row: SavedRow, sat?: SatContext): SavedQuestion {
  return {
    id: row.id,
    questionId: row.questionId,
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
