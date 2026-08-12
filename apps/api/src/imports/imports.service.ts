import { Injectable } from '@nestjs/common';
import { type StudentImportPlan, type StudentImportResult } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { planStudentImport, type ImportContext } from './student-import';
import { readCsvTable } from './csv';
import { mobileSchema } from '@iace/contracts';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What the file would do. Writes nothing. */
  async previewStudents(csv: string): Promise<StudentImportPlan> {
    return planStudentImport(csv, await this.contextFor(csv));
  }

  /**
   * Applies the plan. Re-plans from the same input rather than trusting a
   * preview the client sends back: the file may have changed, and a client that
   * can hand us a plan can hand us any plan.
   *
   * Only valid rows are written. One bad number must not cost the other 399.
   */
  async commitStudents(csv: string): Promise<StudentImportResult> {
    const plan = await this.previewStudents(csv);

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
  private async contextFor(csv: string): Promise<ImportContext> {
    const table = readCsvTable(csv);

    const mobiles = new Set<string>();
    const groupNames = new Set<string>();
    for (const row of table.rows) {
      const parsed = mobileSchema.safeParse(row.values.mobile ?? '');
      if (parsed.success) mobiles.add(parsed.data);
      for (const name of (row.values.groups ?? '').split(/[;|]/)) {
        const trimmed = name.trim();
        if (trimmed) groupNames.add(trimmed.toLowerCase());
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
        ? this.prisma.group.findMany({ select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    return {
      existingByMobile: new Map(
        students.map((s) => [s.mobile, { id: s.id, fullName: s.fullName }]),
      ),
      groupsByName: new Map(groups.map((g) => [g.name.toLowerCase(), { id: g.id, name: g.name }])),
    };
  }
}
