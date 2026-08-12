import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type GroupMemberImportPlan,
  type GroupMemberImportResult,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PinService } from '../auth/pin/pin.service';
import { defaultPinFor } from './default-pin';
import {
  mobilesInMemberFile,
  planGroupMemberImport,
  type GroupMemberContext,
} from './group-member-import';
import {
  groupEntriesIn,
  mobilesIn,
  planStudentImport,
  type ImportContext,
  type ImportGroup,
} from './student-import';
import { type CsvTable } from './csv';
import { readUploadedTable } from './workbook';

/**
 * How many PINs to hash at once. Node's default libuv threadpool is 4 threads,
 * so more would queue anyway while multiplying the transient memory.
 */
const HASH_CONCURRENCY = 4;

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

    // Hashed up front, and in parallel. argon2 is deliberately ~13ms a go, so
    // doing it inside the write loop made a 1,000-row roster thirteen seconds
    // of a single request sitting idle on one core. Node runs argon2 on the
    // libuv threadpool, so a handful at a time is most of the win for none of
    // the memory (each hash allocates ~19MB while it runs).
    const pinHashes = await this.hashStartingPins(
      plan.rows.filter((row) => row.willReceiveDefaultPin && row.mobile).map((row) => row.mobile!),
    );

    let created = 0;
    let updated = 0;

    for (const row of plan.rows) {
      if (row.action === 'skip' || !row.mobile) continue;

      // A starting PIN, so an uploaded roster can sign in the same day — marked
      // as ours, not theirs. See default-pin.ts for the trade.
      const startingPin = row.willReceiveDefaultPin
        ? { pinHash: pinHashes.get(row.mobile), pinIsDefault: true }
        : {};

      // Groups are added, never replaced: a roster for one group must not
      // remove a student from the others they are already in.
      const groups = row.groupIds.length
        ? { groups: { connect: row.groupIds.map((id) => ({ id })) } }
        : {};

      if (row.existingStudentId) {
        await this.prisma.student.update({
          where: { id: row.existingStudentId },
          data: {
            // An empty name column means "no opinion", not "clear the name". An
            // existing student also keeps whatever PIN they have — see the
            // planner: `willReceiveDefaultPin` is false once they chose one.
            ...(row.fullName === null ? {} : { fullName: row.fullName }),
            ...startingPin,
            ...groups,
          },
        });
        updated += 1;
      } else {
        await this.prisma.student.create({
          data: { mobile: row.mobile, fullName: row.fullName, ...startingPin, ...groups },
        });
        created += 1;
      }
    }

    return { ...plan.summary, created, updated, skipped: plan.summary.invalid };
  }

  /**
   * Mobile → the hash of that student's starting PIN.
   *
   * Bounded concurrency rather than Promise.all over the whole file: argon2 is
   * memory-hard by design, and a thousand at once would ask for ~19GB.
   */
  private async hashStartingPins(mobiles: string[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();

    for (let start = 0; start < mobiles.length; start += HASH_CONCURRENCY) {
      const batch = mobiles.slice(start, start + HASH_CONCURRENCY);
      const hashed = await Promise.all(batch.map((m) => this.pin.hash(defaultPinFor(m))));
      batch.forEach((mobile, index) => hashes.set(mobile, hashed[index]!));
    }

    return hashes;
  }

  // ==========================================================================
  // Adding students to one group
  // ==========================================================================

  /** What the file would add to this group. Writes nothing. */
  async previewGroupMembers(groupId: string, file: Buffer): Promise<GroupMemberImportPlan> {
    const table = await readUploadedTable(file);
    return planGroupMemberImport(table, await this.groupContextFor(groupId, table));
  }

  /**
   * Applies it. Re-plans from the file rather than trusting a plan the client
   * sends back, for the same reason the student import does: the file may have
   * changed, and a client that can hand us a plan can hand us any plan.
   */
  async commitGroupMembers(groupId: string, file: Buffer): Promise<GroupMemberImportResult> {
    const plan = await this.previewGroupMembers(groupId, file);

    const toAdd = plan.rows
      .filter((row) => row.action === 'add' && row.studentId)
      .map((row) => ({ id: row.studentId as string }));

    if (toAdd.length > 0) {
      // One connect for the whole file: membership is a set, so this is a
      // single statement rather than a round trip per student.
      await this.prisma.group.update({
        where: { id: groupId },
        data: { students: { connect: toAdd } },
      });
    }

    return { ...plan.summary, added: toAdd.length };
  }

  private async groupContextFor(groupId: string, table: CsvTable): Promise<GroupMemberContext> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { branch: { select: { name: true } } },
    });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    const mobiles = mobilesInMemberFile(table);

    const [students, members] = await Promise.all([
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, fullName: true },
          })
        : Promise.resolve([]),
      // Only the members this file could possibly mention, not the whole group:
      // a batch of 2,000 must not be loaded to add ten people to it.
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles }, groups: { some: { id: groupId } } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      group: { id: group.id, name: group.name, branchName: group.branch.name },
      studentsByMobile: new Map(
        students.map((student) => [student.mobile, { id: student.id, fullName: student.fullName }]),
      ),
      memberIds: new Set(members.map((member) => member.id)),
    };
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
