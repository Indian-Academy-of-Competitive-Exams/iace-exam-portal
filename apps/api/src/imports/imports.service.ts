import { Injectable } from '@nestjs/common';
import { type StudentImportPlan, type StudentImportResult } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PinService } from '../auth/pin/pin.service';
import { defaultPinFor } from './default-pin';
import {
  groupEntriesIn,
  mobilesIn,
  planStudentImport,
  type ImportContext,
  type ImportGroup,
} from './student-import';
import { type CsvTable } from './csv';
import { readUploadedTable } from './workbook';

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pin: PinService,
  ) {}

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
            // A student already in the system keeps whatever PIN they have. An
            // import must never reset a PIN somebody chose, or re-importing a
            // roster would quietly hand every one of them back to the sheet.
            ...(row.willReceiveDefaultPin
              ? {
                  pinHash: await this.pin.hash(defaultPinFor(row.mobile)),
                  pinIsDefault: true,
                }
              : {}),
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
            // A starting PIN, so an uploaded roster can sign in the same day —
            // marked as ours, not theirs. See default-pin.ts for the trade.
            pinHash: await this.pin.hash(defaultPinFor(row.mobile)),
            pinIsDefault: true,
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
    const mobiles = mobilesIn(table);
    const groupNames = groupEntriesIn(table);

    const [students, groups] = await Promise.all([
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, fullName: true, pinHash: true },
          })
        : Promise.resolve([]),
      groupNames.length
        ? this.prisma.group.findMany({
            select: { id: true, name: true, branch: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      existingByMobile: new Map(
        students.map((s) => [
          s.mobile,
          { id: s.id, fullName: s.fullName, hasPin: s.pinHash !== null },
        ]),
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
