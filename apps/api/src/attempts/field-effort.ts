/** A paper's cohort in EFFORT alone, by section: questions answered and the clock. No mark leaves here. */
import { round2, type SectionEffortFigure } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { IN_COHORT } from './ranking-sql';
import { sectionScoresIn } from './score-paper';
import { topperIdOf } from './topper';

export interface FieldShape {
  cohortSize: number;
  average: SectionEffortFigure[];
  /** Whose effort `topper` is, so the student who asked can be told apart from them. */
  topperStudentId: string | null;
  topper: SectionEffortFigure[] | null;
}

export const NO_FIELD: FieldShape = {
  cohortSize: 0,
  average: [],
  topperStudentId: null,
  topper: null,
};

interface SectionSum {
  section_id: string;
  sittings: number;
  attempted: number;
  time_sec: number;
}

/** A sitting's stamped sections as effort. Null where no scorer has stamped any. */
export function effortIn(stored: unknown): SectionEffortFigure[] | null {
  const sections = sectionScoresIn(stored);
  if (sections === null || sections.length === 0) return null;
  return sections.map((section) => ({
    baseConfigSectionId: section.baseConfigSectionId,
    attempted: section.correctCount + section.wrongCount,
    timeSpentSec: section.timeSpentSec,
  }));
}

/** Counted live off the cohort's own sittings, like the curve: no rollup stores answered questions by section. */
export async function fieldEffortOf(prisma: PrismaService, testId: string): Promise<FieldShape> {
  const [sums, topperId] = await Promise.all([
    prisma.$queryRaw<SectionSum[]>`
      SELECT part->>0 AS section_id,
             COUNT(*)::int AS sittings,
             SUM((part->>2)::int + (part->>3)::int)::int AS attempted,
             SUM((part->>5)::bigint)::float8 AS time_sec
      FROM "Attempt", jsonb_array_elements(COALESCE("sectionScores", '[]'::jsonb)) part
      WHERE "testId" = ${testId}::uuid AND ${IN_COHORT}
      GROUP BY part->>0`,
    topperIdOf(prisma, testId),
  ]);
  const topper =
    topperId === null
      ? null
      : await prisma.attempt.findUnique({
          where: { id: topperId },
          select: { studentId: true, sectionScores: true },
        });

  return {
    cohortSize: Math.max(0, ...sums.map((row) => row.sittings)),
    average: sums.map((row) => ({
      baseConfigSectionId: row.section_id,
      attempted: round2(row.attempted / row.sittings),
      timeSpentSec: Math.round(row.time_sec / row.sittings),
    })),
    topperStudentId: topper?.studentId ?? null,
    topper: effortIn(topper?.sectionScores),
  };
}
