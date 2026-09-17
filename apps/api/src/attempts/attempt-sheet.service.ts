/** The one writer of `AttemptSheet.answers`: seeded at start, patched by the flusher, written whole at submit. */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { blankSheet, encodeAnswer, sheetOf, type AnswerSheet } from './answer-sheet';
import { type HeldState } from './attempt-state';
import { PaperSheetService } from './paper-sheet.service';

const whileLive = (attemptId: string) =>
  Prisma.sql`EXISTS (SELECT 1 FROM "Attempt" WHERE "id" = ${attemptId} AND "status" = ${ATTEMPT_STATUS.IN_PROGRESS}::"AttemptStatus")`;

@Injectable()
export class AttemptSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly papers: PaperSheetService,
  ) {}

  /** Inside the start's own transaction: one untouched slot per paper row. */
  async create(tx: Prisma.TransactionClient, attemptId: string, testId: string): Promise<void> {
    const size = await tx.paperQuestion.count({ where: { testId } });
    await tx.attemptSheet.create({ data: { attemptId, answers: blankSheet(size) } });
  }

  /** The flusher's write: the named slots in place, one statement, only while the sitting is live. */
  async patch(held: HeldState, questionIds: readonly string[]): Promise<void> {
    const paper = await this.papers.rowsOf(held.testId);
    const startedAt = new Date(held.startedAt);
    let answers = Prisma.sql`"answers"`;
    let patched = 0;
    paper.forEach((row, slot) => {
      const answer = held.answers[row.questionId];
      if (answer === undefined || !questionIds.includes(row.questionId)) return;
      const value = JSON.stringify(encodeAnswer(answer, row.optionIds, startedAt));
      answers = Prisma.sql`jsonb_set(${answers}, ARRAY[${String(slot)}]::text[], ${value}::jsonb)`;
      patched += 1;
    });
    if (patched === 0) return;
    await this.prisma.$executeRaw`
      UPDATE "AttemptSheet" SET "answers" = ${answers}, "updatedAt" = now()
      WHERE "attemptId" = ${held.attemptId} AND ${whileLive(held.attemptId)}`;
  }

  /** Submit's write: every live answer at once, so nothing a flush missed can be lost. */
  async write(held: HeldState, onlyWhileLive: boolean): Promise<AnswerSheet> {
    const paper = await this.papers.rowsOf(held.testId);
    const sheet = sheetOf(held.answers, paper, new Date(held.startedAt));
    const gate = onlyWhileLive ? Prisma.sql`AND ${whileLive(held.attemptId)}` : Prisma.empty;
    await this.prisma.$executeRaw`
      UPDATE "AttemptSheet" SET "answers" = ${JSON.stringify(sheet)}::jsonb, "updatedAt" = now()
      WHERE "attemptId" = ${held.attemptId} ${gate}`;
    return sheet;
  }
}
