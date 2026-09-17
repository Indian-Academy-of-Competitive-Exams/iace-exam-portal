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

const TERMS_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  questionVersion: { select: { options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

/** What a sat paper pays per row, all frozen: status and type still move, so `liveTermsOf` reads them fresh. */
export interface PaperTerm extends SheetPaperRow {
  marks: number;
  negativeMarks: number;
  correctOptionIds: string[];
  answerKey: AnswerKey | null;
}

export interface LiveTerm {
  status: PaperQuestionStatus;
  type: QuestionType;
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

  /** The answer key rides here: scoring is the only caller. */
  async termsOf(testId: string): Promise<PaperTerm[]> {
    const held = this.terms.get(testId);
    if (held) return held;
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: TERMS_SELECT,
    });
    const read = rows.map(({ questionVersion, marks, negativeMarks, ...row }) => ({
      ...row,
      marks: Number(marks),
      negativeMarks: Number(negativeMarks),
      correctOptionIds: correctOptionIdsIn(questionVersion.options),
      answerKey: answerKeyIn(questionVersion.answerKey),
    }));
    remember(this.terms, testId, read);
    return read;
  }

  /** Read every job: a drop moves a status, and a question's type is still editable after it is served. */
  async liveTermsOf(testId: string): Promise<LiveTerm[]> {
    const rows = await this.prisma.paperQuestion.findMany({
      where: { testId },
      orderBy: { order: 'asc' },
      select: { status: true, question: { select: { type: true } } },
    });
    return rows.map((row) => ({ status: row.status, type: row.question.type }));
  }
}
