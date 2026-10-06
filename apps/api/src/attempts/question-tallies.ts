/** What one student did with each question across their newest marked sittings: the grain a topic report sums. */
import { ATTEMPT_STATUS, REPORT_SITTINGS_MAX } from '@iace/contracts';
import { type PrismaService } from '../prisma/prisma.service';
import { answeredRows } from './answer-sheet';
import { type PaperSheetService } from './paper-sheet.service';

export interface QuestionTally {
  /** Sittings the question was on the paper of. */
  seen: number;
  answered: number;
  correct: number;
  timeSpentSec: number;
}

/** Read through the held paper rows, so a slot is matched to the question the sheet was written against. */
export async function questionTalliesOf(
  { prisma, papers }: { prisma: PrismaService; papers: PaperSheetService },
  studentId: string,
): Promise<Map<string, QuestionTally>> {
  const sittings = await prisma.attempt.findMany({
    where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: REPORT_SITTINGS_MAX,
    select: {
      testId: true,
      startedAt: true,
      shuffleSeed: true,
      sheet: { select: { answers: true, verdicts: true } },
    },
  });

  const tallies = new Map<string, QuestionTally>();
  for (const sitting of sittings) {
    const paper = await papers.rowsOf(sitting.testId);
    for (const row of answeredRows(paper, sitting)) {
      const tally = tallies.get(row.questionId) ?? {
        seen: 0,
        answered: 0,
        correct: 0,
        timeSpentSec: 0,
      };
      tally.seen += 1;
      tally.timeSpentSec += row.timeSpentSec;
      // A blank and a dropped question carry no verdict: seen, and neither right nor wrong.
      if (row.isCorrect !== null) {
        tally.answered += 1;
        if (row.isCorrect) tally.correct += 1;
      }
      tallies.set(row.questionId, tally);
    }
  }
  return tallies;
}
