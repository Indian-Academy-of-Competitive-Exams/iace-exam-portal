/** What a finished sitting is worth to the student who sat it, worked out without a database. */
import { type Prisma } from '@prisma/client';
import { type AttemptSectionScore, type ScoreCardSection } from '@iace/contracts';

/** A `Decimal?` column on its way into JSON. Never let the Decimal itself reach a payload. */
export const numberOrNull = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

/** A section as the blueprint describes it, before this student's marks are laid over it. */
export interface SectionShape {
  id: string;
  name: string;
  order: number;
  questionCount: number;
  marksPerQuestion: number;
}

/** What each section of the sat paper was worth, summed off the rows the student was served. */
export function marksBySection(
  questions: readonly { baseConfigSectionId: string; marks: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of questions) {
    totals.set(row.baseConfigSectionId, (totals.get(row.baseConfigSectionId) ?? 0) + row.marks);
  }
  return totals;
}

/** When the LAST sitting can still be running: entry closes, then the whole paper after it. */
export function lastSittingEndsAt(
  closesAt: string | null,
  durationSec: number,
  extraTimeSec: number | null,
): string | null {
  if (closesAt === null) return null;
  const granted = (durationSec + (extraTimeSec ?? 0)) * MS_PER_SECOND;
  return new Date(Date.parse(closesAt) + granted).toISOString();
}

/** A standing is provisional while anybody can still sit the paper and move it. */
export function isProvisional(lastEndsAt: string | null, now: Date): boolean {
  return lastEndsAt === null || Date.parse(lastEndsAt) > now.getTime();
}

/** The one piece of clock arithmetic a sitting needs; what an unfinished one means is per caller. */
export function elapsedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_SECOND));
}

/** Marks over what the paper was worth. Negative when negative marking took them under. */
export function percentageOf(score: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0;
  return Math.round((score / maxMarks) * 100 * HUNDREDTHS) / HUNDREDTHS;
}

/** The blueprint's sections with this sitting's marks laid over them, in the paper's own order. */
export function sectionsWithScores(
  shape: readonly SectionShape[],
  scored: readonly AttemptSectionScore[] | null,
  paperMarks: ReadonlyMap<string, number>,
): ScoreCardSection[] {
  const byId = new Map((scored ?? []).map((section) => [section.baseConfigSectionId, section]));

  return [...shape]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      baseConfigSectionId: section.id,
      name: section.name,
      order: section.order,
      questionCount: section.questionCount,
      // The paper's own marks, not the blueprint's: a per-question mark makes the two differ.
      maxMarks: round(
        paperMarks.get(section.id) ?? section.questionCount * section.marksPerQuestion,
      ),
      score: byId.get(section.id)?.score ?? 0,
      correctCount: byId.get(section.id)?.correctCount ?? 0,
      wrongCount: byId.get(section.id)?.wrongCount ?? 0,
      unattemptedCount: byId.get(section.id)?.unattemptedCount ?? section.questionCount,
      timeSpentSec: byId.get(section.id)?.timeSpentSec ?? 0,
    }));
}

const HUNDREDTHS = 100;
const MS_PER_SECOND = 1000;
const round = (value: number) => Math.round(value * HUNDREDTHS) / HUNDREDTHS;
