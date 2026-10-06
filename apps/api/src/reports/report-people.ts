/** The people a report names: a student's columns, and the admin behind an id that carries no relation. */
import { type Prisma } from '@prisma/client';
import { AppException, ErrorCodes, type ReportFact } from '@iace/contracts';
import { readInBatches, type ExportColumn } from '../common/exporting';
import { type PrismaService } from '../prisma/prisma.service';
import { studentCardsOf, type StudentCard } from '../students';

export const NO_BRANCH = 'No branch';

export const branchOf = (student: StudentCard): string => student.currentBranch?.name ?? NO_BRANCH;

/** The columns a row is read by when the row IS a student. */
export const STUDENT_COLUMNS: ExportColumn<StudentCard>[] = [
  { header: 'Student', width: 28, value: (row) => row.fullName },
  { header: 'Mobile', width: 14, text: true, value: (row) => row.mobile },
  { header: 'Branch', width: 20, value: branchOf },
];

/** The same columns for a row that only HOLDS a student. */
export function studentColumns<Row>(of: (row: Row) => StudentCard): ExportColumn<Row>[] {
  return STUDENT_COLUMNS.map((column) => ({
    ...column,
    value: (row: Row) => column.value(of(row)),
  }));
}

export function cardsOf(prisma: PrismaService, ids: readonly string[]): Promise<StudentCard[]> {
  return readInBatches(ids, (batch) => studentCardsOf(prisma, batch));
}

/** Actor ids carry no foreign key, so the name is looked up; one who has no name is their email. */
export async function adminNames(
  prisma: PrismaService,
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const admins = await prisma.admin.findMany({
    where: { id: { in: wanted } },
    select: { id: true, fullName: true, email: true },
  });
  return new Map(admins.map((admin) => [admin.id, admin.fullName ?? admin.email]));
}

/** Who can still be expected in a hall: not erased, not suspended. */
export const ENROLLED = {
  deletedAt: null,
  isActive: true,
} as const satisfies Prisma.StudentWhereInput;

/** The fact a report narrowed to one branch opens with; nothing when it was not narrowed. */
export async function aboutBranch(prisma: PrismaService, branchId?: string): Promise<ReportFact[]> {
  if (branchId === undefined) return [];
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { name: true },
  });
  if (branch === null) throw new AppException(ErrorCodes.NOT_FOUND, 'That branch does not exist');
  return [{ label: 'Branch', value: branch.name }];
}
