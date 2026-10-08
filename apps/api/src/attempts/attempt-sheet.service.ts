/** The one writer of `AttemptSheet.answers`: seeded at start, then written whole by the flusher and at submit. */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, type AttemptStatus } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { blankSheet, sheetOf, type AnswerSheet } from './answer-sheet';
import { type HeldState } from './attempt-state';
import { PaperSheetService } from './paper-sheet.service';

const whileIn = (attemptId: string, status: AttemptStatus) =>
  Prisma.sql`EXISTS (SELECT 1 FROM "Attempt" WHERE "id" = ${attemptId}::uuid AND "status" = ${status}::"AttemptStatus")`;

@Injectable()
export class AttemptSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly papers: PaperSheetService,
  ) {}

  /** The paper is frozen before any start, so its length is read once per process, never per start. */
  async sizeOf(testId: string): Promise<number> {
    return (await this.papers.rowsOf(testId)).length;
  }

  /** Inside the start's own transaction: one untouched slot per paper row, sized outside it. */
  async create(tx: Prisma.TransactionClient, attemptId: string, size: number): Promise<void> {
    await tx.attemptSheet.create({ data: { attemptId, answers: blankSheet(size) } });
  }

  /** Every live answer at once — the flusher's write while the sitting is live, and submit's last. */
  write(held: HeldState, onlyWhileLive: boolean): Promise<AnswerSheet> {
    return this.writeWhile(held, onlyWhileLive ? ATTEMPT_STATUS.IN_PROGRESS : null);
  }

  /** The same write, landing only while the sitting is in the status named; null gates on nothing. */
  async writeWhile(held: HeldState, status: AttemptStatus | null): Promise<AnswerSheet> {
    const paper = await this.papers.rowsOf(held.testId);
    const sheet = sheetOf(held.answers, paper, new Date(held.startedAt));
    const gate = status ? Prisma.sql`AND ${whileIn(held.attemptId, status)}` : Prisma.empty;
    await this.prisma.$executeRaw`
      UPDATE "AttemptSheet" SET "answers" = ${JSON.stringify(sheet)}::jsonb, "updatedAt" = now()
      WHERE "attemptId" = ${held.attemptId}::uuid ${gate}`;
    await this.writeSections(held, status);
    return sheet;
  }

  /** A composite paper has one clock and no sections, so it pays for nothing here. */
  private async writeSections(held: HeldState, status: AttemptStatus | null): Promise<void> {
    if (Object.keys(held.sections).length === 0) return;
    const gate = status ? Prisma.sql`AND "status" = ${status}::"AttemptStatus"` : Prisma.empty;
    await this.prisma.$executeRaw`
      UPDATE "Attempt" SET "sectionState" = ${JSON.stringify(held.sections)}::jsonb
      WHERE "id" = ${held.attemptId}::uuid ${gate}`;
  }
}
