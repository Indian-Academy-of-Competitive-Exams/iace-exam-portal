/** Subject-wise accuracy, summed off sittings' own section scores: one student's, or a whole cohort's. */
import { sectionScoresIn } from '../attempts';
import { type ExportColumn, type ExportSheet } from '../common/exporting';
import { type ReportSources } from './report';
import { groupBy, minutesOf, percentOf } from './report-figures';

export interface SubjectRow {
  subject: string;
  correct: number;
  wrong: number;
  blank: number;
  timeSpentSec: number;
}

const accuracyOf = (row: SubjectRow): number | null =>
  percentOf(row.correct, row.correct + row.wrong);

const SUBJECT_COLUMNS: ExportColumn<SubjectRow>[] = [
  { header: 'Subject', width: 30, value: (row) => row.subject },
  { header: 'Correct', width: 9, value: (row) => row.correct },
  { header: 'Wrong', width: 9, value: (row) => row.wrong },
  { header: 'Blank', width: 9, value: (row) => row.blank },
  { header: 'Accuracy (%)', width: 13, value: accuracyOf },
  { header: 'Time (min)', width: 11, value: (row) => minutesOf(row.timeSpentSec) },
];

/** A section filed under no subject reads by its own name. `weakestFirst` orders a cohort's page; a student's reads by name. */
export async function subjectSheet(
  { prisma }: ReportSources,
  packed: readonly unknown[],
  weakestFirst = false,
): Promise<ExportSheet<SubjectRow>> {
  const scores = packed.flatMap((stored) => sectionScoresIn(stored) ?? []);
  const sections = await prisma.baseConfigSection.findMany({
    where: { id: { in: [...new Set(scores.map((score) => score.baseConfigSectionId))] } },
    select: { id: true, name: true, subject: { select: { name: true } } },
  });
  const subjectOf = new Map(
    sections.map((section) => [section.id, section.subject?.name ?? section.name]),
  );
  const rows = [...groupBy(scores, (score) => subjectOf.get(score.baseConfigSectionId) ?? '')]
    .map(([subject, held]) => ({
      subject,
      correct: held.reduce((sum, score) => sum + score.correctCount, 0),
      wrong: held.reduce((sum, score) => sum + score.wrongCount, 0),
      blank: held.reduce((sum, score) => sum + score.unattemptedCount, 0),
      timeSpentSec: held.reduce((sum, score) => sum + score.timeSpentSec, 0),
    }))
    .sort((a, b) =>
      weakestFirst
        ? (accuracyOf(a) ?? Number.POSITIVE_INFINITY) - (accuracyOf(b) ?? Number.POSITIVE_INFINITY)
        : a.subject.localeCompare(b.subject),
    );
  return { name: 'Subjects', columns: SUBJECT_COLUMNS, rows };
}
