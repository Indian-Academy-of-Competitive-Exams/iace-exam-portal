import { Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  type AuditAction,
  type ImportLogStatus,
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
import { isRecordNotFound, isUniqueViolation } from '../common/prisma-errors';
import { AuditService } from '../audit';
import { StorageService } from '../storage/storage.service';
import { mobilesIn, planStudentImport, type ImportContext } from './student-import';
import { planCandidateImport } from './candidate-import';
import { planProgramImport } from './program-import';
import { EventsService } from '../events';
import { ProgramsService } from '../access';

import {
  importFileKey,
  readUploadedTable,
  refuseFileErrors,
  rowsWithErrors,
  type CsvTable,
} from '../common/importing';
import { type ExportSheet } from '../common/exporting';
import { toDateColumn } from '../common/time/institute-day';

interface RowAction {
  entityId: string;
  action: AuditAction;
}

/** The access lists a student held when the run was planned. */
type HeldAccess = Pick<StudentImportRow, 'enrolledCourses' | 'enrolledExams' | 'programs'>;

/** Why a row the plan meant to write was skipped at the write: the student went between the two. */
const ERASED_MEANWHILE =
  'This student was erased while the import was running, so nothing in this row was written.';

/** What a run had written when it closed. A failure carries the same shape — it wrote rows too. */
interface RunOutcome {
  rowActions: RowAction[];
  /** A row the plan passed and the write refused, by its line in the sheet. Kept on the run. */
  rowErrors: { line: number; error: string }[];
  /** `skipped` is every row the run did not write; `failed` is only what a run that died never reached. */
  counts: { created: number; updated: number; skipped: number; failed: number };
}

/** Owns no tables (docs/03 §5). */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly programs: ProgramsService,
  ) {}

  /** What the file would do. Writes nothing — only a commit opens a run, see `openRun`. */
  async previewStudents(file: Buffer): Promise<StudentImportPlan> {
    return this.planStudents(await readUploadedTable(file));
  }

  /** The rows a preview would skip, as the file had them. Writes nothing, like the preview. */
  async studentErrorRows(file: Buffer): Promise<ExportSheet> {
    const table = await readUploadedTable(file);
    return rosterErrorRows(table, await this.planStudents(table));
  }

  /** Applies the plan. Re-plans from the same input rather than trusting a preview the client sends back: the file may have changed, and a client that can hand us a plan can hand us any plan. */
  async commitStudents(file: Buffer, actorId: string): Promise<StudentImportResult> {
    const table = await readUploadedTable(file);
    const context = await this.contextFor(table);
    // Re-judged against the scope on COMMIT too: a preview is not a permission check.
    const plan = planStudentImport(table, context);
    const run = await this.withRun(
      file,
      plan,
      actorId,
      { skipped: plan.summary.invalid },
      async (outcome) => {
        for (const row of plan.rows) {
          if (row.action === 'skip' || !row.mobile) continue;

          const done = await this.writeRow(row, context.existingByMobile.get(row.mobile));
          if (!done) {
            outcome.counts.skipped += 1;
            outcome.rowErrors.push({ line: row.line, error: ERASED_MEANWHILE });
            continue;
          }
          if (done.action === AUDIT_ACTION.CREATE) outcome.counts.created += 1;
          else outcome.counts.updated += 1;
          outcome.rowActions.push(done);
        }
      },
    );

    const { created, updated, skipped } = run.counts;
    return { ...plan.summary, created, updated, skipped };
  }

  /** Writes nothing. The event has to exist, so a stale page cannot fill a deleted roster. */
  async previewEventCandidates(eventId: string, file: Buffer): Promise<CandidateImportPlan> {
    await this.events.detail(eventId);
    return this.planCandidates(await readUploadedTable(file));
  }

  async eventCandidateErrorRows(eventId: string, file: Buffer): Promise<ExportSheet> {
    await this.events.detail(eventId);
    const table = await readUploadedTable(file);
    return rosterErrorRows(table, await this.planCandidates(table));
  }

  /** An existing number only JOINS the roster: nothing on that student is touched. */
  async commitEventCandidates(
    eventId: string,
    file: Buffer,
    actorId: string,
  ): Promise<CandidateImportResult> {
    await this.events.detail(eventId);
    const plan = await this.planCandidates(await readUploadedTable(file));
    const studentIds: string[] = [];

    const run = await this.withRun(
      file,
      plan,
      actorId,
      { skipped: plan.summary.invalid },
      async (outcome) => {
        try {
          for (const row of plan.rows) {
            if (row.action === 'skip' || !row.mobile) continue;

            const done: RowAction = row.existingStudentId
              ? { entityId: row.existingStudentId, action: AUDIT_ACTION.UPDATE }
              : await this.createCandidate(row.mobile, row.fullName);
            if (done.action === AUDIT_ACTION.CREATE) outcome.counts.created += 1;
            else outcome.counts.updated += 1;
            studentIds.push(done.entityId);
            outcome.rowActions.push(done);
          }
        } finally {
          // Even when a row threw: an account this run created and left off the roster reaches nothing. Through the service that owns `EventCandidate` (docs/03 §5).
          await this.events.addCandidates(eventId, studentIds);
        }
      },
    );

    return {
      ...plan.summary,
      created: run.counts.created,
      added: studentIds.length,
      skipped: plan.summary.invalid,
    };
  }

  /** Writes nothing. The program has to exist and be offered, or there is nothing to enrol into. */
  async previewProgramStudents(code: string, file: Buffer): Promise<ProgramImportPlan> {
    await this.programs.assertUsable([code], 'programCode');
    return this.planPrograms(code, await readUploadedTable(file));
  }

  async programStudentErrorRows(code: string, file: Buffer): Promise<ExportSheet> {
    await this.programs.assertUsable([code], 'programCode');
    const table = await readUploadedTable(file);
    return rosterErrorRows(table, await this.planPrograms(code, table));
  }

  /** Adds the code to students who already exist. A number we do not know is skipped, never created. */
  async commitProgramStudents(
    code: string,
    file: Buffer,
    actorId: string,
  ): Promise<ProgramImportResult> {
    await this.programs.assertUsable([code], 'programCode');

    const plan = await this.planPrograms(code, await readUploadedTable(file));
    const skipped = plan.summary.invalid + plan.summary.alreadyEnrolled;

    const enrolling = plan.rows.flatMap((row) =>
      row.action === 'enrol' && row.studentId !== null ? [row.studentId] : [],
    );

    const run = await this.withRun(file, plan, actorId, { skipped }, async (outcome) => {
      if (enrolling.length === 0) return;
      // The guard is what `push` lacked: a student enrolled since the preview would hold the code twice.
      const enrolled = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Student" SET "programs" = array_append("programs", ${code})
        WHERE "id" = ANY(${enrolling}::uuid[]) AND NOT ("programs" @> ARRAY[${code}])
        RETURNING "id"`;

      outcome.counts.updated = enrolled.length;
      outcome.rowActions.push(
        ...enrolled.map((row) => ({ entityId: row.id, action: AUDIT_ACTION.UPDATE })),
      );
    });

    return { ...plan.summary, enrolled: run.counts.updated, skipped };
  }

  /** A number we did not know becomes a NON_IACE account; one registered since the plan only joins, as it would have. */
  private async createCandidate(mobile: string, fullName: string | null): Promise<RowAction> {
    try {
      const student = await this.prisma.student.create({
        // Outside the institute and at no centre of ours: the event is the whole of their access.
        data: { mobile, fullName, studentType: STUDENT_TYPE.NON_IACE },
      });
      return { entityId: student.id, action: AUDIT_ACTION.CREATE };
    } catch (error) {
      return { entityId: await this.holderOf(mobile, error), action: AUDIT_ACTION.UPDATE };
    }
  }

  /** One row's write, and what the audit trail should call it. Null when the student it names was erased since the plan. */
  private async writeRow(row: StudentImportRow, held?: HeldAccess): Promise<RowAction | null> {
    const { mobile, studentType } = row;
    if (mobile === null || studentType === null) {
      throw new Error(`Row ${row.line} reached the commit without a mobile or a student type`);
    }

    const profile = profileData(row);
    const placement = placementOf(row, studentType);

    if (row.existingStudentId) {
      return this.updateRow(row.existingStudentId, row, { placement, profile }, held);
    }

    try {
      const student = await this.prisma.student.create({
        data: {
          mobile,
          fullName: row.fullName,
          ...placement,
          enrolledCourses: row.enrolledCourses,
          enrolledExams: row.enrolledExams,
          programs: row.programs,
          ...(profile ? { profile: { create: profile } } : {}),
        },
      });
      return { entityId: student.id, action: AUDIT_ACTION.CREATE };
    } catch (error) {
      return this.writeRow({ ...row, existingStudentId: await this.holderOf(mobile, error) });
    }
  }

  /** A row for a student already here: what the sheet says of them and the access it adds. Null when they were erased since the plan. */
  private async updateRow(
    id: string,
    row: StudentImportRow,
    { placement, profile }: RowWrite,
    held?: HeldAccess,
  ): Promise<RowAction | null> {
    const update = this.prisma.student.update({
      // Live only: a student erased since the plan takes none of this row back onto their tombstone.
      where: { id, deletedAt: null },
      data: {
        // An empty name column means "no opinion", not "clear the name".
        ...(row.fullName === null ? {} : { fullName: row.fullName }),
        ...placement,
        // The branch follows the sheet, and only a NON_IACE row reaches here without one.
        ...(row.currentBranchId === null ? { currentBranch: { disconnect: true } } : {}),
        ...(profile ? { profile: { upsert: { create: profile, update: profile } } } : {}),
      },
    });
    const append = this.accessAppend(id, row, held);
    const writes: Prisma.PrismaPromise<unknown>[] = append ? [update, append] : [update];
    try {
      // Together or not at all: a row is never left with its name written and its enrolments not.
      await this.prisma.$transaction(writes);
    } catch (error) {
      if (isRecordNotFound(error) && !(await this.isLive(id))) return null;
      throw error;
    }
    return { entityId: id, action: AUDIT_ACTION.UPDATE };
  }

  /** Who holds a number a create just lost to: registered since the plan, so the row is theirs. Anything else is rethrown. */
  private async holderOf(mobile: string, error: unknown): Promise<string> {
    const holder = isUniqueViolation(error)
      ? await this.prisma.student.findFirst({
          where: { mobile, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!holder) throw error;
    return holder.id;
  }

  /** A not-found on the update is the erasure only if the student is no longer live; a branch removed mid-run reads the same. */
  private async isLive(id: string): Promise<boolean> {
    return (await this.prisma.student.count({ where: { id, deletedAt: null } })) > 0;
  }

  /** The statement that appends what the sheet brought and they do not hold as it runs, unrun; null when the sheet brought nothing new. */
  private accessAppend(
    id: string,
    row: StudentImportRow,
    held?: HeldAccess,
  ): Prisma.PrismaPromise<number> | null {
    const courses = addedTo(held?.enrolledCourses, row.enrolledCourses);
    const exams = addedTo(held?.enrolledExams, row.enrolledExams);
    const programs = addedTo(held?.programs, row.programs);
    if (courses.length + exams.length + programs.length === 0) return null;

    return this.prisma.$executeRaw`
      UPDATE "Student" SET
        "enrolledCourses" = "enrolledCourses" || ARRAY(
          SELECT c FROM unnest(${courses}::"ExamCourse"[]) AS c WHERE c <> ALL("enrolledCourses")),
        "enrolledExams" = "enrolledExams" || ARRAY(
          SELECT e FROM unnest(${exams}::text[]) AS e WHERE e <> ALL("enrolledExams")),
        "programs" = "programs" || ARRAY(
          SELECT p FROM unnest(${programs}::text[]) AS p WHERE p <> ALL("programs"))
      WHERE "id" = ${id}::uuid`;
  }

  private async planCandidates(table: CsvTable): Promise<CandidateImportPlan> {
    const mobiles = mobilesIn(table);
    const students =
      mobiles.length === 0
        ? []
        : await this.prisma.student.findMany({
            where: { mobile: { in: mobiles } },
            select: { id: true, mobile: true, deletedAt: true },
          });

    return planCandidateImport(table, {
      existingByMobile: new Map(
        students
          .filter((student) => student.deletedAt === null)
          .map((student) => [student.mobile, { id: student.id }]),
      ),
      deletedMobiles: new Set(
        students.filter((student) => student.deletedAt !== null).map((student) => student.mobile),
      ),
    });
  }

  private async planPrograms(code: string, table: CsvTable): Promise<ProgramImportPlan> {
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

  private async planStudents(table: CsvTable): Promise<StudentImportPlan> {
    return planStudentImport(table, await this.contextFor(table));
  }

  /** Loads only the mobiles this file refers to rather than the whole table, so a 5,000-row roster is one bounded query and not a table scan per line. */
  private async contextFor(table: CsvTable): Promise<ImportContext> {
    const mobiles = mobilesIn(table);

    // Whole small catalogs: cheaper than a lookup per row, and a roster repeats a branch.
    const [branches, exams, programs, students] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
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
              currentBranchId: true,
              enrolledCourses: true,
              enrolledExams: true,
              programs: true,
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
            currentBranchId: student.currentBranchId,
            enrolledCourses: student.enrolledCourses,
            enrolledExams: student.enrolledExams,
            programs: student.programs,
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

  /** Opens the run, lets `write` record what it wrote, and closes the run on that whether or not it finished. */
  private async withRun(
    file: Buffer,
    plan: { summary: { total: number }; fileErrors: readonly string[] },
    actorId: string,
    counts: Partial<RunOutcome['counts']>,
    write: (outcome: RunOutcome) => Promise<void>,
  ): Promise<RunOutcome> {
    const logId = await this.openRun(plan.summary.total, plan.fileErrors, actorId);
    const outcome: RunOutcome = {
      rowActions: [],
      rowErrors: [],
      counts: { created: 0, updated: 0, skipped: 0, failed: 0, ...counts },
    };

    try {
      await this.storeFile(logId, file);
      await write(outcome);
    } catch (error) {
      const { created, updated, skipped } = outcome.counts;
      outcome.counts.failed = plan.summary.total - created - updated - skipped;
      await this.closeRun(logId, IMPORT_LOG_STATUS.FAILED, outcome, actorId, {
        fileErrors: plan.fileErrors,
        error,
      });
      throw error;
    }

    await this.closeRun(logId, IMPORT_LOG_STATUS.COMMITTED, outcome, actorId);
    return outcome;
  }

  /** Only a commit opens a run: a row for an abandoned preview is storage nothing ever resolves. */
  private async openRun(
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

    return log.id;
  }

  /** Inside the run's try, so a storage outage closes the run instead of leaving it open with no file. */
  private async storeFile(logId: string, file: Buffer): Promise<void> {
    const key = importFileKey(AUDIT_FEATURE.STUDENT, logId, file);
    await this.storage.upload(key, file);
    await this.prisma.importLog.update({ where: { id: logId }, data: { fileS3Key: key } });
  }

  /** Both endings, one path: the rows are recorded before the status is written, and a failure to record them is swallowed, because by now the writes they describe already happened. */
  private async closeRun(
    logId: string,
    status: ImportLogStatus,
    written: RunOutcome,
    actorId: string,
    failure?: { fileErrors: readonly string[]; error: unknown },
  ): Promise<void> {
    try {
      await this.audit.recordImportRows(logId, AUDIT_FEATURE.STUDENT, written.rowActions, actorId);
    } catch (error) {
      this.logger.error(`Row actions for import ${logId} were not recorded`, error);
    }

    const errors = {
      ...(failure && failure.fileErrors.length > 0 ? { fileErrors: failure.fileErrors } : {}),
      ...(written.rowErrors.length > 0 ? { rowErrors: written.rowErrors } : {}),
      ...(failure
        ? {
            message: failure.error instanceof Error ? failure.error.message : String(failure.error),
          }
        : {}),
    };
    await this.prisma.importLog.update({
      where: { id: logId },
      data: {
        ...written.counts,
        status,
        finishedAt: new Date(),
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      },
    });
  }
}

function rosterErrorRows(
  table: CsvTable,
  plan: { rows: readonly { line: number; errors: string[] }[]; fileErrors: readonly string[] },
): ExportSheet {
  refuseFileErrors(plan.fileErrors);
  return rowsWithErrors(table, new Map(plan.rows.map((row) => [row.line, row.errors])));
}

/** By relation, not the raw FK: Prisma refuses an unchecked id beside the nested profile write. */
function placementOf(row: StudentImportRow, studentType: StudentType) {
  return {
    studentType,
    ...(row.currentBranchId ? { currentBranch: { connect: { id: row.currentBranchId } } } : {}),
  };
}

/** What both of a row's writes are built from. */
interface RowWrite {
  placement: ReturnType<typeof placementOf>;
  profile: ReturnType<typeof profileData>;
}

/** What a planned row holds beyond what the student held when the plan was made. */
function addedTo<T>(held: readonly T[] | undefined, planned: readonly T[]): T[] {
  return planned.filter((value) => !held?.includes(value));
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
