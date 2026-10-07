/** A sat paper, cached per process: `paper_question_sat_guard` freezes its rows, `question_version_sat_guard` their options and key. */
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type AnswerKey, type PaperQuestionStatus, type QuestionType } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { answerKeyIn, optionsIn } from '../common/prisma-json';

export const SHEET_ROW_SELECT = {
  id: true,
  questionId: true,
  baseConfigSectionId: true,
  optionIds: true,
} as const satisfies Prisma.PaperQuestionSelect;

export type SheetPaperRow = Prisma.PaperQuestionGetPayload<{ select: typeof SHEET_ROW_SELECT }>;

/** The candidate's view: both guards freeze every column here once one student has sat the paper. */
const SERVED_ROW_SELECT = {
  questionId: true,
  baseConfigSectionId: true,
  marks: true,
  negativeMarks: true,
  question: { select: { type: true } },
  questionVersion: { select: { content: true, options: true } },
} as const satisfies Prisma.PaperQuestionSelect;

export type ServedPaperRow = Prisma.PaperQuestionGetPayload<{ select: typeof SERVED_ROW_SELECT }>;

/** The review's view: the sheet's columns, the paper's terms, and the KEY — held only where a review is served. */
const SOLUTION_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
  question: { select: { type: true } },
  questionVersion: { select: { content: true, options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

export type SolutionPaperRow = Prisma.PaperQuestionGetPayload<{
  select: typeof SOLUTION_ROW_SELECT;
}>;

const TERMS_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
  question: { select: { type: true, subjectId: true } },
  questionVersion: { select: { options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

/** What a sat paper pays per row. Every column but `status` is frozen, and `Test.paperRevision` keys that one. */
export interface PaperTerm extends SheetPaperRow {
  type: QuestionType;
  subjectId: string | null;
  status: PaperQuestionStatus;
  marks: number;
  negativeMarks: number;
  correctOptionIds: string[];
  answerKey: AnswerKey | null;
}

function correctOptionIdsIn(options: Prisma.JsonValue): string[] {
  return optionsIn(options)
    .filter((option) => option?.isCorrect === true && typeof option.id === 'string')
    .map((option) => option.id);
}

/** Papers held at once: a worker handles a handful of tests at a time, this only bounds a long-lived process. */
export const HELD_PAPERS = 64;

/** A hit re-inserts, which is what makes the eviction below least-RECENTLY-USED and not first-in. */
export function recall<V>(held: Map<string, V>, key: string): V | undefined {
  const value = held.get(key);
  if (value === undefined) return undefined;
  held.delete(key);
  held.set(key, value);
  return value;
}

/** A Map iterates in insertion order, so the first key is the one longest unread. */
export function remember<V>(
  held: Map<string, V>,
  key: string,
  value: V,
  ceiling = HELD_PAPERS,
): void {
  if (!held.delete(key) && held.size >= ceiling) {
    const coldest = held.keys().next();
    if (!coldest.done) held.delete(coldest.value);
  }
  held.set(key, value);
}

/** The PROMISE is held, not the rows: every request arriving during a cold read waits on that read. */
export function hold<V>(
  held: Map<string, Promise<V>>,
  key: string,
  read: () => Promise<V>,
  ceiling = HELD_PAPERS,
): Promise<V> {
  const waiting = recall(held, key);
  if (waiting) return waiting;

  const next = read();
  remember(held, key, next, ceiling);
  // Not held once it fails, so the next reader retries instead of inheriting the failure.
  next.catch(() => {
    if (held.get(key) === next) held.delete(key);
  });
  return next;
}

@Injectable()
export class PaperSheetService {
  private readonly rows = new Map<string, Promise<SheetPaperRow[]>>();
  private readonly terms = new Map<string, Promise<PaperTerm[]>>();
  private readonly served = new Map<string, Promise<ServedPaperRow[]>>();
  private readonly solutions = new Map<string, Promise<SolutionPaperRow[]>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Only for a test somebody has sat: an unsat paper can still change under a cached copy. */
  rowsOf(testId: string): Promise<SheetPaperRow[]> {
    return hold(this.rows, testId, () =>
      this.prisma.paperQuestion.findMany({
        where: { testId },
        orderBy: { order: 'asc' },
        select: SHEET_ROW_SELECT,
      }),
    );
  }

  /** The same paper for every candidate, so it is read once. */
  servedOf(testId: string): Promise<ServedPaperRow[]> {
    return hold(this.served, testId, () => this.servedNow(testId));
  }

  /** The same rows read fresh and never held, for a reader that is not a sitting: an unsat paper can still change. */
  servedNow(testId: string): Promise<ServedPaperRow[]> {
    return this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: SERVED_ROW_SELECT,
    });
  }

  /** Every reader of one paper's review gets the same rows, so a results storm reads it once. */
  solutionsOf(testId: string, paperRevision: number): Promise<SolutionPaperRow[]> {
    return hold(this.solutions, `${testId}:${paperRevision}`, () =>
      this.prisma.paperQuestion.findMany({
        where: { testId },
        orderBy: { order: 'asc' },
        select: SOLUTION_ROW_SELECT,
      }),
    );
  }

  /** The answer key rides here, held: scoring is the only caller. A drop bumps the revision, so a stale copy is unreachable. */
  termsOf(testId: string, paperRevision: number): Promise<PaperTerm[]> {
    return hold(this.terms, `${testId}:${paperRevision}`, () => this.readTerms(testId));
  }

  /** The same terms read fresh and never held, for a reader that is not the scorer: an unsat paper can still change. */
  termsNow(testId: string): Promise<PaperTerm[]> {
    return this.readTerms(testId);
  }

  private async readTerms(testId: string): Promise<PaperTerm[]> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: TERMS_SELECT,
    });
    return rows.map(({ question, questionVersion, marks, negativeMarks, ...row }) => ({
      ...row,
      type: question.type,
      subjectId: question.subjectId,
      marks: Number(marks),
      negativeMarks: Number(negativeMarks),
      correctOptionIds: correctOptionIdsIn(questionVersion.options),
      answerKey: answerKeyIn(questionVersion.answerKey),
    }));
  }
}
