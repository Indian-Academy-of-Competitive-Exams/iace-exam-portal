/** A sat paper, cached per process: `paper_question_sat_guard` freezes its rows, `question_version_sat_guard` their options and key. */
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  type AnswerKey,
  type PaperQuestionStatus,
  type QuestionOption,
  type QuestionType,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';

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

const TERMS_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
  question: { select: { type: true } },
  questionVersion: { select: { options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

/** What a sat paper pays per row. Every column but `status` is frozen, and `Test.paperRevision` keys that one. */
export interface PaperTerm extends SheetPaperRow {
  type: QuestionType;
  status: PaperQuestionStatus;
  marks: number;
  negativeMarks: number;
  correctOptionIds: string[];
  answerKey: AnswerKey | null;
}

function correctOptionIdsIn(options: Prisma.JsonValue): string[] {
  if (!Array.isArray(options)) return [];
  return (options as unknown as QuestionOption[])
    .filter((option) => option?.isCorrect === true && typeof option.id === 'string')
    .map((option) => option.id);
}

function answerKeyIn(key: Prisma.JsonValue): AnswerKey | null {
  if (typeof key !== 'object' || key === null || Array.isArray(key)) return null;
  return key as unknown as AnswerKey;
}

/** Papers held at once: a worker handles a handful of tests at a time, this only bounds a long-lived process. */
const HELD_PAPERS = 64;

export function remember<V>(held: Map<string, V>, key: string, value: V): void {
  if (held.size >= HELD_PAPERS) {
    const oldest = held.keys().next();
    if (!oldest.done) held.delete(oldest.value);
  }
  held.set(key, value);
}

@Injectable()
export class PaperSheetService {
  private readonly rows = new Map<string, SheetPaperRow[]>();
  private readonly terms = new Map<string, PaperTerm[]>();
  private readonly served = new Map<string, ServedPaperRow[]>();

  constructor(private readonly prisma: PrismaService) {}

  /** Only for a test somebody has sat: an unsat paper can still change under a cached copy. */
  async rowsOf(testId: string): Promise<SheetPaperRow[]> {
    const held = this.rows.get(testId);
    if (held) return held;
    const read = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: SHEET_ROW_SELECT,
    });
    remember(this.rows, testId, read);
    return read;
  }

  /** The same paper for every candidate, so it is read once. */
  async servedOf(testId: string): Promise<ServedPaperRow[]> {
    const held = this.served.get(testId);
    if (held) return held;
    const read = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: SERVED_ROW_SELECT,
    });
    remember(this.served, testId, read);
    return read;
  }

  /** The answer key rides here: scoring is the only caller. A drop bumps the revision, so a stale copy is unreachable. */
  async termsOf(testId: string, paperRevision: number): Promise<PaperTerm[]> {
    const key = `${testId}:${paperRevision}`;
    const held = this.terms.get(key);
    if (held) return held;
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: TERMS_SELECT,
    });
    const read = rows.map(({ question, questionVersion, marks, negativeMarks, ...row }) => ({
      ...row,
      type: question.type,
      marks: Number(marks),
      negativeMarks: Number(negativeMarks),
      correctOptionIds: correctOptionIdsIn(questionVersion.options),
      answerKey: answerKeyIn(questionVersion.answerKey),
    }));
    remember(this.terms, key, read);
    return read;
  }
}
