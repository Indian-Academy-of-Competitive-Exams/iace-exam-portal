/**
 * The students list as a workbook, under the list's own filters and order. The roster is written in
 * the import's columns and vocabulary, so an edited copy goes straight back through the importer;
 * the performance view reads the attempts rollups and carries no percentile, which is a live count.
 */
import { type Prisma } from '@prisma/client';
import {
  STUDENT_EXPORT_VIEWS,
  STUDENT_IMPORT_COLUMNS,
  type StudentExportQuery,
  type StudentImportColumnKey,
} from '@iace/contracts';
import { type StudentOverviewService, type StudentRollup } from '../attempts';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { fromDateColumn } from '../common/time/institute-day';
import { type PrismaService } from '../prisma/prisma.service';
import { studentOrderBy, studentWhere } from './student-query';

/** Written as the importer splits a list cell back apart. */
const LIST_SEPARATOR = ', ';

const ROSTER_SELECT = {
  id: true,
  mobile: true,
  fullName: true,
  studentType: true,
  enrolledCourses: true,
  enrolledExams: true,
  programs: true,
  isActive: true,
  isTestBlocked: true,
  createdAt: true,
  currentBranch: { select: { name: true } },
  profile: {
    select: {
      motherName: true,
      fatherName: true,
      dob: true,
      email: true,
      gender: true,
      address: true,
    },
  },
} as const satisfies Prisma.StudentSelect;

type RosterRow = Prisma.StudentGetPayload<{ select: typeof ROSTER_SELECT }>;

interface PerformanceRow extends RosterRow {
  rollup: StudentRollup | undefined;
}

export interface StudentExport {
  workbook: Buffer;
  rows: number;
}

export interface StudentExportSources {
  prisma: PrismaService;
  rollups: StudentOverviewService;
}

export async function buildStudentExport(
  { prisma, rollups }: StudentExportSources,
  query: StudentExportQuery,
): Promise<StudentExport> {
  // The list's filters with no page: every matching row, not the one page the screen showed.
  const where = studentWhere({ ...query, page: 1, pageSize: 1 });
  assertExportable(await prisma.student.count({ where }));
  const students = await prisma.student.findMany({
    where,
    orderBy: studentOrderBy(query.sort),
    select: ROSTER_SELECT,
  });

  if (query.view === STUDENT_EXPORT_VIEWS.ROSTER) {
    const workbook = await writeWorkbook([
      { name: 'Students', columns: ROSTER_COLUMNS, rows: students },
    ]);
    return { workbook, rows: students.length };
  }

  const { subjects, byStudent } = await rollups.rollupsFor(students.map((student) => student.id));
  const rows = students.map((student) => ({ ...student, rollup: byStudent.get(student.id) }));
  const subjectColumns = subjects.map((subject): ExportColumn<PerformanceRow> => ({
    header: `${subject.name} accuracy (%)`,
    width: 16,
    value: (row) => row.rollup?.subjectAccuracy.get(subject.id) ?? null,
  }));
  const workbook = await writeWorkbook([
    { name: 'Performance', columns: [...PERFORMANCE_COLUMNS, ...subjectColumns], rows },
  ]);
  return { workbook, rows: rows.length };
}

const joined = (values: readonly string[]) => values.join(LIST_SEPARATOR);

/** Exhaustive over the import's keys, so a column added there cannot be missed here. */
const IMPORT_VALUES: Record<StudentImportColumnKey, (row: RosterRow) => string | null> = {
  mobile: (row) => row.mobile,
  fullName: (row) => row.fullName,
  studentType: (row) => row.studentType,
  branchName: (row) => row.currentBranch?.name ?? null,
  enrolledCourses: (row) => joined(row.enrolledCourses),
  enrolledExams: (row) => joined(row.enrolledExams),
  programs: (row) => joined(row.programs),
  motherName: (row) => row.profile?.motherName ?? null,
  fatherName: (row) => row.profile?.fatherName ?? null,
  dob: (row) => (row.profile?.dob ? fromDateColumn(row.profile.dob) : null),
  email: (row) => row.profile?.email ?? null,
  gender: (row) => row.profile?.gender ?? null,
  address: (row) => row.profile?.address ?? null,
};

function statusOf(row: RosterRow): string {
  if (!row.isActive) return 'Sign-in suspended';
  return row.isTestBlocked ? 'Tests blocked' : 'Active';
}

const ROSTER_COLUMNS: ExportColumn<RosterRow>[] = [
  ...STUDENT_IMPORT_COLUMNS.map((column): ExportColumn<RosterRow> => ({
    header: column.header,
    width: column.width,
    text: true,
    value: IMPORT_VALUES[column.key],
  })),
  { header: 'Status', width: 18, value: statusOf },
  {
    header: 'Created',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.createdAt),
  },
];

const PERFORMANCE_COLUMNS: ExportColumn<PerformanceRow>[] = [
  { header: 'Student', width: 28, value: (row) => row.fullName },
  { header: 'Mobile', width: 14, text: true, value: (row) => row.mobile },
  { header: 'Branch', width: 20, value: (row) => row.currentBranch?.name ?? null },
  { header: 'Tests attempted', width: 15, value: (row) => row.rollup?.testsAttempted ?? 0 },
  { header: 'Tests evaluated', width: 15, value: (row) => row.rollup?.testsEvaluated ?? 0 },
  { header: 'Average score', width: 14, value: (row) => row.rollup?.avgScore ?? null },
  { header: 'Accuracy (%)', width: 13, value: (row) => row.rollup?.accuracy ?? null },
  { header: 'Average time (sec)', width: 18, value: (row) => row.rollup?.avgTimeSec ?? null },
  {
    header: 'Last attempt',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.rollup?.lastAttemptAt ?? null),
  },
];
