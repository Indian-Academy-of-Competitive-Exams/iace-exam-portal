/** A sat paper's frozen rows, read once per process per test: `paper_question_sat_guard` makes caching them safe. */
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const SHEET_ROW_SELECT = {
  id: true,
  questionId: true,
  baseConfigSectionId: true,
  optionIds: true,
} as const satisfies Prisma.PaperQuestionSelect;

export type SheetPaperRow = Prisma.PaperQuestionGetPayload<{ select: typeof SHEET_ROW_SELECT }>;

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
}
