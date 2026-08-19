import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ErrorCodes,
  GROUP_TYPES_ACCEPTING_GRANTS,
  IMPORT_SOURCE,
  STUDENT_TYPE,
  type AuditAction,
  type AuditFeature,
  type GroupMemberImportPlan,
  type GroupMemberImportResult,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth';
import { AuditService } from '../audit';
import { StorageService } from '../storage/storage.service';
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
import {
  IMPORT_LOG_STATUS,
  importFileKey,
  readUploadedTable,
  type CsvTable,
  type ImportLogStatus,
} from '../common/importing';

/**
 * How many PINs to hash at once. Node's default libuv threadpool is 4 threads, so more would queue
 * anyway while multiplying the transient memory.
 */
const HASH_CONCURRENCY = 4;

/** What a run had written when it closed. A failure carries the same shape — it wrote rows too. */
interface RunOutcome {
  feature: AuditFeature;
  rowActions: readonly { entityId: string; action: AuditAction }[];
  counts: { created: number; updated: number; skipped: number; failed: number };
  actorId: string;
}

/** Owns no tables (docs/03 §5). */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** What the file would do. Writes nothing — only a commit opens a run, see `openRun`. */
  async previewStudents(file: Buffer): Promise<StudentImportPlan> {
    return this.planStudents(file);
  }

  /**
   * Applies the plan. Re-plans from the same input rather than trusting a preview the client sends
   * back: the file may have changed, and a client that can hand us a plan can hand us any plan.
   */
  async commitStudents(file: Buffer, actorId: string): Promise<StudentImportResult> {
    const plan = await this.planStudents(file);
    const logId = await this.openRun(file, plan.summary.total, plan.fileErrors, actorId);

    let created = 0;
    let updated = 0;
    const rowActions: { entityId: string; action: AuditAction }[] = [];
    // A thunk, not a value: the failure path has to close on the rows the loop already wrote.
    const written = (): RunOutcome => ({
      feature: AUDIT_FEATURE.STUDENT,
      rowActions,
      counts: { created, updated, skipped: 0, failed: plan.summary.invalid },
      actorId,
    });

    try {
      // Hashed up front, and in parallel. argon2 is deliberately ~13ms a go, so doing it inside the
      // write loop made a 1,000-row roster thirteen seconds of a single request sitting idle on one
      // core.
      const pinHashes = await this.hashStartingPins(
        plan.rows
          .filter((row) => row.willReceiveDefaultPin && row.mobile)
          .map((row) => row.mobile!),
      );

      // The grants each existing student already holds, so adding a group to them
      // is a union rather than a duplicate — one bounded read, not one per row.
      const grantsById = await this.grantsFor(
        plan.rows.map((row) => row.existingStudentId).filter((id): id is string => id !== null),
      );

      for (const row of plan.rows) {
        if (row.action === 'skip' || !row.mobile) continue;

        // A starting PIN, so an uploaded roster can sign in the same day — marked
        // as ours, not theirs. See default-pin.ts for the trade.
        const startingPin = row.willReceiveDefaultPin
          ? { pinHash: pinHashes.get(row.mobile), pinIsDefault: true }
          : {};

        if (row.existingStudentId) {
          // Groups are added, never replaced: a roster for one group must not
          // remove a student from the others they are already in.
          const grants = new Set([
            ...(grantsById.get(row.existingStudentId) ?? []),
            ...row.groupIds,
          ]);

          await this.prisma.student.update({
            where: { id: row.existingStudentId },
            data: {
              // An empty name column means "no opinion", not "clear the name". An existing student also keeps
              // whatever PIN they have — see the planner: `willReceiveDefaultPin` is false once they chose one.
              ...(row.fullName === null ? {} : { fullName: row.fullName }),
              ...startingPin,
              directGroupIds: [...grants],
            },
          });
          updated += 1;
          rowActions.push({ entityId: row.existingStudentId, action: AUDIT_ACTION.UPDATE });
        } else {
          const student = await this.prisma.student.create({
            data: {
              mobile: row.mobile,
              fullName: row.fullName,
              studentType: STUDENT_TYPE.ONLINE,
              createdVia: IMPORT_SOURCE.SHEET,
              directGroupIds: row.groupIds,
              ...startingPin,
            },
          });
          created += 1;
          rowActions.push({ entityId: student.id, action: AUDIT_ACTION.CREATE });
        }
      }
    } catch (error) {
      await this.closeRun(logId, IMPORT_LOG_STATUS.FAILED, written(), {
        fileErrors: plan.fileErrors,
        error,
      });
      throw error;
    }

    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, written());

    return { ...plan.summary, created, updated, skipped: plan.summary.invalid };
  }

  private async planStudents(file: Buffer): Promise<StudentImportPlan> {
    const table = await readUploadedTable(file);
    return planStudentImport(table, await this.contextFor(table));
  }

  /**
   * Mobile -> the hash of that student's starting PIN. Bounded concurrency, not
   * Promise.all: argon2 is memory-hard, and a thousand at once would ask for ~19GB.
   */
  private async hashStartingPins(mobiles: string[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();

    for (let start = 0; start < mobiles.length; start += HASH_CONCURRENCY) {
      const batch = mobiles.slice(start, start + HASH_CONCURRENCY);
      const hashed = await Promise.all(batch.map((m) => this.auth.hashPin(defaultPinFor(m))));
      batch.forEach((mobile, index) => hashes.set(mobile, hashed[index]!));
    }

    return hashes;
  }

  // ==========================================================================
  // Adding students to one group
  // ==========================================================================

  /** What the file would add to this group. Writes nothing. */
  async previewGroupMembers(groupId: string, file: Buffer): Promise<GroupMemberImportPlan> {
    return this.planGroupMembers(groupId, file);
  }

  /** Applies it. */
  async commitGroupMembers(
    groupId: string,
    file: Buffer,
    actorId: string,
  ): Promise<GroupMemberImportResult> {
    const plan = await this.planGroupMembers(groupId, file);
    const logId = await this.openRun(file, plan.summary.total, plan.fileErrors, actorId);

    const toAdd = plan.rows
      .filter((row) => row.action === 'add' && row.studentId)
      .map((row) => row.studentId as string);

    const skipped = plan.summary.alreadyMembers;
    const failed = plan.summary.invalid;

    try {
      // The planner already left out anyone holding this grant, so a push cannot
      // duplicate one.
      await this.prisma.$transaction(
        toAdd.map((studentId) =>
          this.prisma.student.update({
            where: { id: studentId },
            data: { directGroupIds: { push: groupId } },
          }),
        ),
      );
    } catch (error) {
      // One transaction, so a failure wrote nothing — the counts a failed run reports are the
      // file's own, never the grants it was going to add.
      await this.closeRun(
        logId,
        IMPORT_LOG_STATUS.FAILED,
        {
          feature: AUDIT_FEATURE.STUDENT,
          rowActions: [],
          counts: { created: 0, updated: 0, skipped, failed },
          actorId,
        },
        { fileErrors: plan.fileErrors, error },
      );
      throw error;
    }

    // Every added row is an existing student gaining a grant — never a create.
    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, {
      feature: AUDIT_FEATURE.STUDENT,
      rowActions: toAdd.map((studentId) => ({ entityId: studentId, action: AUDIT_ACTION.UPDATE })),
      counts: { created: 0, updated: toAdd.length, skipped, failed },
      actorId,
    });

    return { ...plan.summary, added: toAdd.length };
  }

  private async planGroupMembers(groupId: string, file: Buffer): Promise<GroupMemberImportPlan> {
    const table = await readUploadedTable(file);
    return planGroupMemberImport(table, await this.groupContextFor(groupId, table));
  }

  private async groupContextFor(groupId: string, table: CsvTable): Promise<GroupMemberContext> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, examType: true, type: true },
    });
    if (!group) throw new AppException(ErrorCodes.NOT_FOUND, 'No such group');

    const mobiles = mobilesInMemberFile(table);

    const [students, members] = await Promise.all([
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, fullName: true, isTestBlocked: true },
          })
        : Promise.resolve([]),
      // Only the members this file could possibly mention, not the whole group:
      // a batch of 2,000 must not be loaded to add ten people to it.
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles }, directGroupIds: { has: groupId } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      group,
      studentsByMobile: new Map(
        students.map((student) => [
          student.mobile,
          { id: student.id, fullName: student.fullName, isTestBlocked: student.isTestBlocked },
        ]),
      ),
      memberIds: new Set(members.map((member) => member.id)),
    };
  }

  /**
   * Loads only what this file refers to — the mobiles it lists and the groups it names — rather than
   * the whole table, so a 5,000-row roster is two bounded queries and not a table scan per line.
   */
  private async contextFor(table: CsvTable): Promise<ImportContext> {
    const mobiles = mobilesIn(table);
    const groupNames = groupEntriesIn(table);

    const [students, groups] = await Promise.all([
      mobiles.length
        ? this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, fullName: true, pinHash: true, isTestBlocked: true },
          })
        : Promise.resolve([]),
      groupNames.length
        ? this.prisma.group.findMany({
            // A roster grants groups student by student, so only the types that means anything for
            // are loadable. Anything else falls through to "No group called X".
            where: { type: { in: [...GROUP_TYPES_ACCEPTING_GRANTS] } },
            select: { id: true, name: true, examType: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      existingByMobile: new Map(
        students.map((s) => [
          s.mobile,
          {
            id: s.id,
            fullName: s.fullName,
            hasPin: s.pinHash !== null,
            isTestBlocked: s.isTestBlocked,
          },
        ]),
      ),
      groupsByName: groupsByCanonicalName(groups),
    };
  }

  /** Student id → the groups already granted to them. */
  private async grantsFor(studentIds: string[]): Promise<Map<string, string[]>> {
    if (studentIds.length === 0) return new Map();

    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, directGroupIds: true },
    });
    return new Map(students.map((student) => [student.id, student.directGroupIds]));
  }

  // ==========================================================================
  // ImportLog lifecycle — both importers only ever touch Student rows, so the
  // run and its rows are always logged under AUDIT_FEATURE.STUDENT.
  // ==========================================================================

  /** Only a commit opens a run: a row for an abandoned preview is storage nothing ever resolves. */
  private async openRun(
    file: Buffer,
    total: number,
    fileErrors: readonly string[],
    actorId: string,
  ): Promise<string> {
    const log = await this.prisma.importLog.create({
      data: {
        feature: AUDIT_FEATURE.STUDENT,
        source: IMPORT_SOURCE.SHEET,
        actorId,
        total,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: fileErrors.length > 0 ? { fileErrors } : undefined,
      },
    });

    const key = importFileKey(AUDIT_FEATURE.STUDENT, log.id);
    await this.storage.upload(key, file);
    await this.prisma.importLog.update({ where: { id: log.id }, data: { fileS3Key: key } });

    return log.id;
  }

  /**
   * Both endings, one path: the rows are recorded before the status is written, and a failure to
   * record them is swallowed, because by now the writes they describe already happened.
   */
  private async closeRun(
    logId: string,
    status: ImportLogStatus,
    written: RunOutcome,
    failure?: { fileErrors: readonly string[]; error: unknown },
  ): Promise<void> {
    try {
      await this.audit.recordImportRows(
        logId,
        written.feature,
        written.rowActions,
        written.actorId,
      );
    } catch (error) {
      this.logger.error(`Row actions for import ${logId} were not recorded`, error);
    }

    await this.prisma.importLog.update({
      where: { id: logId },
      data: {
        ...written.counts,
        status,
        finishedAt: new Date(),
        ...(failure
          ? {
              errors: {
                ...(failure.fileErrors.length > 0 ? { fileErrors: failure.fileErrors } : {}),
                message:
                  failure.error instanceof Error ? failure.error.message : String(failure.error),
              },
            }
          : {}),
      },
    });
  }
}

/** Group name → every group carrying it, one per exam type. */
function groupsByCanonicalName(groups: ImportGroup[]): Map<string, ImportGroup[]> {
  const byName = new Map<string, ImportGroup[]>();
  for (const group of groups) {
    const existing = byName.get(group.name);
    if (existing) existing.push(group);
    else byName.set(group.name, [group]);
  }
  return byName;
}
