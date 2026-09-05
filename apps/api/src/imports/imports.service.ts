import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  type AuditAction,
  type AuditFeature,
  type ImportLogStatus,
  type ImportSource,
  type StudentImportPlan,
  type StudentImportResult,
  type StudentImportRow,
  type StudentType,
  type CandidateImportPlan,
  type CandidateImportResult,
  type ProgramImportPlan,
  type ProgramImportResult,
  STUDENT_TYPE,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StartingPinService, type StartingPin } from '../auth';
import { AuditService } from '../audit';
import { StorageService } from '../storage/storage.service';
import { mobilesIn, planStudentImport, type ImportContext } from './student-import';
import { fetchPortalRoster, type PortalFetch } from './portal-roster';
import { planCandidateImport } from './candidate-import';
import { planProgramImport } from './program-import';
import { EventsService } from '../events';
import { ProgramsService } from '../access';

import { isPreTestReady } from '../students';
import { importFileKey, readUploadedTable, type CsvTable } from '../common/importing';
import { toDateColumn } from '../common/time/institute-day';

/**
 * How many PINs to hash at once. Node's default libuv threadpool is 4 threads, so more would queue
 * anyway while multiplying the transient memory.
 */

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
    private readonly startingPins: StartingPinService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly programs: ProgramsService,
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
    // Re-judged against the scope on COMMIT too: a preview is not a permission check.
    const plan = await this.planStudents(file);
    return this.applyPlan(plan, file, IMPORT_SOURCE.SHEET, actorId);
  }

  /** Writes nothing. The event has to exist, so a stale page cannot fill a deleted roster. */
  async previewEventCandidates(eventId: string, file: Buffer): Promise<CandidateImportPlan> {
    await this.events.detail(eventId);
    return this.planCandidates(file);
  }

  /** An existing number only JOINS the roster: nothing on that student is touched. */
  async commitEventCandidates(
    eventId: string,
    file: Buffer,
    actorId: string,
  ): Promise<CandidateImportResult> {
    await this.events.detail(eventId);
    const plan = await this.planCandidates(file);
    const logId = await this.openRun(
      file,
      plan.summary.total,
      plan.fileErrors,
      IMPORT_SOURCE.SHEET,
      actorId,
    );

    let created = 0;
    const studentIds: string[] = [];
    const rowActions: { entityId: string; action: AuditAction }[] = [];
    const issued: StartingPin[] = [];
    const written = (): RunOutcome => ({
      feature: AUDIT_FEATURE.STUDENT,
      rowActions,
      counts: {
        created,
        updated: studentIds.length - created,
        skipped: 0,
        failed: plan.summary.invalid,
      },
      actorId,
    });

    try {
      const minted = byMobile(
        await this.startingPins.mint(
          plan.rows.flatMap((row) =>
            row.action === 'create' && row.mobile !== null ? [row.mobile] : [],
          ),
        ),
      );

      for (const row of plan.rows) {
        if (row.action === 'skip' || !row.mobile) continue;

        if (row.existingStudentId) {
          studentIds.push(row.existingStudentId);
          rowActions.push({ entityId: row.existingStudentId, action: AUDIT_ACTION.UPDATE });
          continue;
        }

        const pin = minted.get(row.mobile);
        const student = await this.prisma.student.create({
          data: {
            mobile: row.mobile,
            fullName: row.fullName,
            // Outside the institute and at no centre of ours: the event is the whole of their access.
            studentType: STUDENT_TYPE.NON_IACE,
            pinHash: pin?.hash,
            pinIsDefault: true,
          },
        });
        if (pin) issued.push(pin);
        created += 1;
        studentIds.push(student.id);
        rowActions.push({ entityId: student.id, action: AUDIT_ACTION.CREATE });
      }

      // Through the service that owns the table, so every candidate's catalog is busted with them.
      await this.events.addCandidates(eventId, studentIds);
    } catch (error) {
      await this.closeRun(logId, IMPORT_LOG_STATUS.FAILED, written(), {
        fileErrors: plan.fileErrors,
        error,
      });
      throw error;
    }

    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, written());
    await this.startingPins.announce(issued);

    return {
      ...plan.summary,
      created,
      added: studentIds.length,
      skipped: plan.summary.invalid,
    };
  }

  /** Writes nothing. The program has to exist and be offered, or there is nothing to enrol into. */
  async previewProgramStudents(code: string, file: Buffer): Promise<ProgramImportPlan> {
    await this.programs.assertUsable([code], 'programCode');
    return this.planPrograms(code, file);
  }

  /** Adds the code to students who already exist. A number we do not know is skipped, never created. */
  async commitProgramStudents(
    code: string,
    file: Buffer,
    actorId: string,
  ): Promise<ProgramImportResult> {
    await this.programs.assertUsable([code], 'programCode');

    const plan = await this.planPrograms(code, file);
    const logId = await this.openRun(
      file,
      plan.summary.total,
      plan.fileErrors,
      IMPORT_SOURCE.SHEET,
      actorId,
    );

    const rowActions: { entityId: string; action: AuditAction }[] = [];
    const written = (): RunOutcome => ({
      feature: AUDIT_FEATURE.STUDENT,
      rowActions,
      counts: {
        created: 0,
        updated: rowActions.length,
        skipped: plan.summary.alreadyEnrolled,
        failed: plan.summary.invalid,
      },
      actorId,
    });

    try {
      for (const row of plan.rows) {
        if (row.action !== 'enrol' || row.studentId === null) continue;

        await this.prisma.student.update({
          where: { id: row.studentId },
          data: { programs: { push: code } },
        });
        rowActions.push({ entityId: row.studentId, action: AUDIT_ACTION.UPDATE });
      }
    } catch (error) {
      await this.closeRun(logId, IMPORT_LOG_STATUS.FAILED, written(), {
        fileErrors: plan.fileErrors,
        error,
      });
      throw error;
    }

    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, written());

    return { ...plan.summary, enrolled: rowActions.length, skipped: plan.summary.invalid };
  }

  /** What the portal WOULD do, judged by the same planner the sheet goes through. */
  async previewPortalStudents(): Promise<StudentImportPlan> {
    const fetched = await fetchPortalRoster();
    return this.planPortal(fetched);
  }

  /** Re-fetches rather than trusting a plan sent back: the roster may have moved on. */
  async commitPortalStudents(actorId: string): Promise<StudentImportResult> {
    const fetched = await fetchPortalRoster();
    const plan = await this.planPortal(fetched);
    return this.applyPlan(plan, fetched.payload, IMPORT_SOURCE.SCRIPT, actorId);
  }

  /** The write half, shared: the two sources differ in origin and artifact, never in what is written. */
  private async applyPlan(
    plan: StudentImportPlan,
    artifact: Buffer,
    source: ImportSource,
    actorId: string,
  ): Promise<StudentImportResult> {
    const logId = await this.openRun(
      artifact,
      plan.summary.total,
      plan.fileErrors,
      source,
      actorId,
    );

    let created = 0;
    let updated = 0;
    const rowActions: { entityId: string; action: AuditAction }[] = [];
    // Only rows that were actually written: a PIN texted for a row that failed opens nothing.
    const issued: StartingPin[] = [];
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
      const minted = byMobile(
        await this.startingPins.mint(
          plan.rows.flatMap((row) =>
            row.willReceiveDefaultPin && row.mobile !== null ? [row.mobile] : [],
          ),
        ),
      );

      for (const row of plan.rows) {
        if (row.action === 'skip' || !row.mobile) continue;

        // A starting PIN, marked as ours not theirs — nobody has chosen one yet.
        const startingPin = row.willReceiveDefaultPin
          ? { pinHash: minted.get(row.mobile)?.hash, pinIsDefault: true }
          : {};

        const done = await this.writeRow(row, startingPin);
        if (done.action === AUDIT_ACTION.CREATE) created += 1;
        else updated += 1;
        rowActions.push(done);

        const pin = row.willReceiveDefaultPin ? minted.get(row.mobile) : undefined;
        if (pin) issued.push(pin);
      }
    } catch (error) {
      await this.closeRun(logId, IMPORT_LOG_STATUS.FAILED, written(), {
        fileErrors: plan.fileErrors,
        error,
      });
      throw error;
    }

    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, written());
    await this.startingPins.announce(issued);

    return { ...plan.summary, created, updated, skipped: plan.summary.invalid };
  }

  /** One row's write, and what the audit trail should call it. */
  private async writeRow(
    row: StudentImportRow,
    startingPin: { pinHash?: string; pinIsDefault?: boolean },
  ): Promise<{ entityId: string; action: AuditAction }> {
    const { mobile, studentType } = row;
    if (mobile === null || studentType === null) {
      throw new Error(`Row ${row.line} reached the commit without a mobile or a student type`);
    }

    const profile = profileData(row);
    // Never downgraded: a row not carrying all three leaves whatever was already true.
    const readiness = isPreTestReady(row.profile) ? { preTestReady: true } : {};
    const access = accessOf(row, studentType);

    if (row.existingStudentId) {
      await this.prisma.student.update({
        where: { id: row.existingStudentId },
        data: {
          // An empty name column means "no opinion", not "clear the name".
          ...(row.fullName === null ? {} : { fullName: row.fullName }),
          ...access,
          ...(profile ? { profile: { upsert: { create: profile, update: profile } } } : {}),
          ...readiness,
          ...startingPin,
        },
      });
      return { entityId: row.existingStudentId, action: AUDIT_ACTION.UPDATE };
    }

    const student = await this.prisma.student.create({
      data: {
        mobile,
        fullName: row.fullName,
        ...access,
        ...(profile ? { profile: { create: profile } } : {}),
        ...readiness,
        ...startingPin,
      },
    });
    return { entityId: student.id, action: AUDIT_ACTION.CREATE };
  }

  private async planCandidates(file: Buffer): Promise<CandidateImportPlan> {
    const table = await readUploadedTable(file);
    const mobiles = mobilesIn(table);
    const students =
      mobiles.length === 0
        ? []
        : await this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, pinHash: true, deletedAt: true },
          });

    return planCandidateImport(table, {
      existingByMobile: new Map(
        students
          .filter((student) => student.deletedAt === null)
          .map((student) => [student.mobile, { id: student.id, hasPin: student.pinHash !== null }]),
      ),
      deletedMobiles: new Set(
        students.filter((student) => student.deletedAt !== null).map((student) => student.mobile),
      ),
    });
  }

  private async planPrograms(code: string, file: Buffer): Promise<ProgramImportPlan> {
    const table = await readUploadedTable(file);
    const mobiles = mobilesIn(table);
    const students =
      mobiles.length === 0
        ? []
        : await this.prisma.student.findMany({
            where: { mobile: { in: mobiles }, deletedAt: null },
            select: { id: true, mobile: true, fullName: true, programs: true },
          });

    return planProgramImport(table, {
      studentsByMobile: new Map(
        students.map((student) => [
          student.mobile,
          { id: student.id, fullName: student.fullName, programs: student.programs },
        ]),
      ),
      programCode: code,
    });
  }

  private async planStudents(file: Buffer): Promise<StudentImportPlan> {
    const table = await readUploadedTable(file);
    return planStudentImport(table, await this.contextFor(table));
  }

  /** A failed fetch is a SOURCE error, never a row error — there are no rows to blame. */
  private async planPortal(fetched: PortalFetch): Promise<StudentImportPlan> {
    const plan = planStudentImport(fetched.table, await this.contextFor(fetched.table));
    return { ...plan, fileErrors: [...fetched.errors, ...plan.fileErrors] };
  }

  /**
   * Loads only the mobiles this file refers to rather than the whole table, so a 5,000-row
   * roster is one bounded query and not a table scan per line.
   */
  private async contextFor(table: CsvTable): Promise<ImportContext> {
    const mobiles = mobilesIn(table);

    // Whole small catalogs: cheaper than a lookup per row, and a roster repeats a branch.
    const [branches, exams, programs, students] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, type: true },
      }),
      this.prisma.exam.findMany({ where: { isActive: true }, select: { code: true } }),
      this.prisma.program.findMany({ where: { isActive: true }, select: { code: true } }),
      mobiles.length === 0
        ? []
        : this.prisma.student.findMany({
            where: { mobile: { in: mobiles }, deletedAt: null },
            select: {
              id: true,
              mobile: true,
              fullName: true,
              pinHash: true,
              currentBranchId: true,
            },
          }),
    ]);

    return {
      existingByMobile: new Map(
        students.map((student) => [
          student.mobile,
          {
            id: student.id,
            fullName: student.fullName,
            hasPin: student.pinHash !== null,
            currentBranchId: student.currentBranchId,
          },
        ]),
      ),
      branchByName: new Map(
        branches.map((branch) => [branch.name, { id: branch.id, type: branch.type }]),
      ),
      examCodes: new Set(exams.map((exam) => exam.code)),
      programCodes: new Set(programs.map((program) => program.code)),
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
    source: ImportSource,
    actorId: string,
  ): Promise<string> {
    const log = await this.prisma.importLog.create({
      data: {
        feature: AUDIT_FEATURE.STUDENT,
        source,
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

/** By relation, not the raw FK: Prisma refuses an unchecked id beside the nested profile write. */
function accessOf(row: StudentImportRow, studentType: StudentType) {
  return {
    studentType,
    ...(row.currentBranchId ? { currentBranch: { connect: { id: row.currentBranchId } } } : {}),
    enrolledCourses: row.enrolledCourses,
    enrolledExams: row.enrolledExams,
    programs: row.programs,
  };
}

/** The profile columns this row filled in, or null when it filled in none. */
function profileData(row: StudentImportRow) {
  const p = row.profile;
  const data = {
    ...(p.motherName === null ? {} : { motherName: p.motherName }),
    ...(p.fatherName === null ? {} : { fatherName: p.fatherName }),
    // Prisma wants a Date for a DATE column; the sheet carries a plain day.
    ...(p.dob === null ? {} : { dob: toDateColumn(p.dob) }),
    ...(p.email === null ? {} : { email: p.email }),
    ...(p.gender === null ? {} : { gender: p.gender }),
    ...(p.address === null ? {} : { address: p.address }),
  };
  return Object.keys(data).length === 0 ? null : data;
}

/** The importer decides row by row, so the minted PINs are indexed by the number they belong to. */
function byMobile(issued: readonly StartingPin[]): Map<string, StartingPin> {
  return new Map(issued.map((pin) => [pin.mobile, pin]));
}
