import { Injectable } from '@nestjs/common';
import { type StudentImportPlan, type StudentImportResult } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { planStudentImport, type ImportContext, type ImportGroup } from './student-import';
import { type CsvTable } from './csv';
import { readUploadedTable } from './workbook';
import { mobileSchema } from '@iace/contracts';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What the file would do. Writes nothing. */
  async previewStudents(file: Buffer): Promise<StudentImportPlan> {
    const table = await readUploadedTable(file);
    return planStudentImport(table, await this.contextFor(table));
  }

  /**
   * Applies the plan. Re-plans from the same input rather than trusting a
   * preview the client sends back: the file may have changed, and a client that
   * can hand us a plan can hand us any plan.
   *
   * Only valid rows are written. One bad number must not cost the other 399.
   */
  async commitStudents(file: Buffer): Promise<StudentImportResult> {
    const plan = await this.previewStudents(file);

    let created = 0;
    let updated = 0;

    for (const row of plan.rows) {
      if (row.action === 'skip' || !row.mobile) continue;

      if (row.existingStudentId) {
        await this.prisma.student.update({
          where: { id: row.existingStudentId },
          data: {
            // An empty name column means "no opinion", not "clear the name".
            ...(row.fullName === null ? {} : { fullName: row.fullName }),
            // Groups are added, never replaced: a roster for one group must not
            // remove a student from the others they are already in.
            ...(row.groupIds.length
              ? { groups: { connect: row.groupIds.map((id) => ({ id })) } }
              : {}),
          },
        });
        updated += 1;
      } else {
        await this.prisma.student.create({
          data: {
            mobile: row.mobile,
            fullName: row.fullName,
            ...(row.groupIds.length
              ? { groups: { connect: row.groupIds.map((id) => ({ id })) } }
              : {}),
          },
        });
        created += 1;
      }
    }

    return { ...plan.summary, created, updated, skipped: plan.summary.invalid };
  }

  /**
   * Loads only what this file refers to — the mobiles it lists and the groups
   * it names — rather than the whole table, so a 5,000-row roster is two
   * bounded queries and not a table scan per line.
   */
  private async contextFor(table: CsvTable): Promise<ImportContext> {
    const mobiles = new Set<string>();
    const groupNames = new Set<string>();
    for (const row of table.rows) {
      const parsed = mobileSchema.safeParse(row.values.mobile ?? '');
      if (parsed.success) mobiles.add(parsed.data);
      for (const entry of (row.values.groups ?? '').split(/[;|]/)) {
        if (entry.trim()) groupNames.add(entry);
      }
    }

    const [students, groups] = await Promise.all([
      mobiles.size
        ? this.prisma.student.findMany({
            where: { mobile: { in: [...mobiles] } },
            select: { id: true, mobile: true, fullName: true },
          })
        : Promise.resolve([]),
      groupNames.size
        ? this.prisma.group.findMany({
            select: { id: true, name: true, branch: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      existingByMobile: new Map(
        students.map((s) => [s.mobile, { id: s.id, fullName: s.fullName }]),
      ),
      groupsByName: groupsByCanonicalName(groups),
    };
  }
}

/**
 * Group name → every group carrying it, one per branch.
 *
 * Names are canonical in the database, so the key needs no folding — but a
 * name can legitimately belong to several branches, and the importer has to be
 * able to tell that apart from a name that matches nothing.
 */
function groupsByCanonicalName(
  groups: { id: string; name: string; branch: { name: string } }[],
): Map<string, ImportGroup[]> {
  const byName = new Map<string, ImportGroup[]>();
  for (const group of groups) {
    const entry = { id: group.id, name: group.name, branchName: group.branch.name };
    const existing = byName.get(group.name);
    if (existing) existing.push(entry);
    else byName.set(group.name, [entry]);
  }
  return byName;
}
