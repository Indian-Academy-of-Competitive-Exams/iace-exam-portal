import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  STUDENT_TYPE,
  type AuditAction,
  type AuditFeature,
  type ImportLogStatus,
  type StudentImportPlan,
  type StudentImportResult,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth';
import { AuditService } from '../audit';
import { StorageService } from '../storage/storage.service';
import { defaultPinFor } from './default-pin';
import { mobilesIn, planStudentImport, type ImportContext } from './student-import';
import { importFileKey, readUploadedTable, type CsvTable } from '../common/importing';

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

      for (const row of plan.rows) {
        if (row.action === 'skip' || !row.mobile) continue;

        // A starting PIN, so an uploaded roster can sign in the same day — marked
        // as ours, not theirs. See default-pin.ts for the trade.
        const startingPin = row.willReceiveDefaultPin
          ? { pinHash: pinHashes.get(row.mobile), pinIsDefault: true }
          : {};

        if (row.existingStudentId) {
          await this.prisma.student.update({
            where: { id: row.existingStudentId },
            data: {
              // An empty name column means "no opinion", not "clear the name". An existing student also keeps
              // whatever PIN they have — see the planner: `willReceiveDefaultPin` is false once they chose one.
              ...(row.fullName === null ? {} : { fullName: row.fullName }),
              ...startingPin,
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

  /**
   * Loads only the mobiles this file refers to rather than the whole table, so a 5,000-row
   * roster is one bounded query and not a table scan per line.
   */
  private async contextFor(table: CsvTable): Promise<ImportContext> {
    const mobiles = mobilesIn(table);
    if (mobiles.length === 0) return { existingByMobile: new Map() };

    const students = await this.prisma.student.findMany({
      where: { mobile: { in: mobiles }, deletedAt: null },
      select: { id: true, mobile: true, fullName: true, pinHash: true },
    });

    return {
      existingByMobile: new Map(
        students.map((student) => [
          student.mobile,
          { id: student.id, fullName: student.fullName, hasPin: student.pinHash !== null },
        ]),
      ),
    };
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
