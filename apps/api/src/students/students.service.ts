import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  AppException,
  ATTEMPT_STATUS,
  BLOCKED_ENROLMENT_MESSAGE,
  ErrorCodes,
  NOTIFICATION_TYPE,
  READINESS_PROFILE_SELECT,
  STUDENT_TYPE,
  educationEntrySchema,
  fieldDiff,
  pastExamEntrySchema,
  readinessOf,
  type EnrolmentStanding,
  type ExamCourse,
  type FieldDiff,
  type Gender,
  type CreateStudentBody,
  type Paginated,
  type ReadinessField,
  type ReportSitting,
  type StudentDetail,
  type StudentListQuery,
  type StudentSittingsQuery,
  type StudentSummary,
  type StudentType,
  type UpdateStudentBody,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { pageArgs, paged } from '../common/pagination';
import { isRecordNotFound, isUniqueViolation } from '../common/prisma-errors';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BranchesService } from '../branches';
import { ExamsService } from '../configs';
import { type ProgramsService } from '../access';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { NotificationsService } from '../notifications';

/** How long a signed link to somebody's photo stays usable. */
const DOCUMENT_URL_TTL_SEC = 300;
import { formerHoldersOf, studentOrderBy, studentWhere } from './student-query';
import { type ProfileDocumentColumn } from './student-flags';
import { fromDateColumn, toDateColumn } from '../common/time/institute-day';
import { everyTermMatches } from '../common/search-terms';
import { maskedMobile } from '../common/redact';
import { HOLDS_OWN_ACCESS } from './own-access';

/** The `fieldErrors` keys the student forms own — `applyFieldErrors` drops any other. */
const ENROLLED_EXAMS_FIELD = 'enrolledExams';
const PROGRAMS_FIELD = 'programs';
const CURRENT_BRANCH_ID_FIELD = 'currentBranchId';

/** What a student's audit diff covers — every column the admin screens can change. */
export const AUDITED_STUDENT_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'enrolledCourses',
  'programs',
  'currentBranchId',
  'isActive',
  'isTestBlocked',
] as const;

/** The profile columns the same save writes. Each is personal, so the diff names the field and withholds what it holds. */
const AUDITED_PROFILE_FIELDS = [
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
] as const;
const WITHHELD = '[withheld]';

/** The single column each toggle route moves — the same `fieldDiff` definition of "changed". */
const AUDITED_ACTIVE_FIELDS = ['isActive'] as const;
const AUDITED_TEST_BLOCKED_FIELDS = ['isTestBlocked'] as const;
const MOBILE_FIELD = 'mobile';
const CHANGED_MEANWHILE = 'That student changed while this was being saved. Open them again.';

/** Owns `Student` and `StudentProfile` (docs/03 §5) — the only module that writes them, `imports` excepted (see its own note; a bulk roster is one statement per file rather than per row). */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => ExamsService))
    private readonly exams: ExamsService,
    private readonly branches: BranchesService,
    // `require`, not a static import: `access` imports `configs`, which imports this barrel back.
    @Inject(
      forwardRef(
        () =>
          (module.require('../access') as { ProgramsService: typeof ProgramsService })
            .ProgramsService,
      ),
    )
    private readonly programs: ProgramsService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
    private readonly notifications: NotificationsService,
  ) {}

  // ==========================================================================
  // Reading
  // ==========================================================================

  async list(query: StudentListQuery): Promise<Paginated<StudentSummary>> {
    const where = studentWhere(query, await formerHoldersOf(this.prisma, query.q));
    // One round trip for the rows and one for the count.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        include: { profile: { select: READINESS_PROFILE_SELECT } },
        orderBy: studentOrderBy(query.sort),
        ...pageArgs(query),
      }),
      this.prisma.student.count({ where }),
    ]);

    const holding = await this.prisma.student.findMany({
      where: { id: { in: rows.map((row) => row.id) }, ...HOLDS_OWN_ACCESS },
      select: { id: true },
    });
    const own = new Set(holding.map((row) => row.id));
    return paged(
      query,
      rows.map((row) => this.toSummary(row, own.has(row.id))),
      total,
    );
  }

  /** Evaluated only, newest first, PAGED — the report's scope picker must reach the oldest one. */
  async sittings(
    studentId: string,
    query: StudentSittingsQuery,
  ): Promise<Paginated<ReportSitting>> {
    const where: Prisma.AttemptWhereInput = {
      studentId,
      status: ATTEMPT_STATUS.EVALUATED,
      ...everyTermMatches<Prisma.AttemptWhereInput>(query.q, (term) => [
        { test: { title: { contains: term, mode: 'insensitive' } } },
      ]),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attempt.findMany({
        where,
        orderBy: { submittedAt: { sort: 'desc', nulls: 'last' } },
        ...pageArgs(query),
        select: {
          id: true,
          submittedAt: true,
          isGraded: true,
          test: { select: { title: true } },
        },
      }),
      this.prisma.attempt.count({ where }),
    ]);

    return paged(
      query,
      rows.map((row) => ({
        attemptId: row.id,
        testTitle: row.test.title,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        isGraded: row.isGraded,
      })),
      total,
    );
  }

  async detail(id: string): Promise<StudentDetail> {
    const student = await this.prisma.student.findFirst({
      where: { id },
      include: {
        profile: true,
        eventCandidacies: { include: { event: { select: { id: true, name: true } } } },
        mobileHistory: {
          orderBy: { createdAt: 'desc' },
          select: { mobile: true, createdAt: true },
        },
      },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    const own = await this.prisma.student.count({ where: { id, ...HOLDS_OWN_ACCESS } });

    return {
      ...this.toSummary(student, own > 0),
      events: student.eventCandidacies.map((candidacy) => candidacy.event),
      formerMobiles: student.mobileHistory
        .filter((row) => row.mobile !== student.mobile)
        .map((row) => ({ mobile: row.mobile, replacedAt: row.createdAt.toISOString() })),
      currentBranchId: student.currentBranchId,
      updatedAt: student.updatedAt.toISOString(),
      profile: student.profile ? await this.toProfileView(student.profile) : null,
    };
  }

  /** Codes to catalog names for the profile screen; one whose row has gone keeps its own code. */
  async enrolmentOf(student: {
    programs: readonly string[];
    enrolledExams: readonly string[];
    currentBranchId: string | null;
  }): Promise<EnrolmentStanding> {
    const [programs, exams, branch] = await Promise.all([
      this.programs.namesByCode(student.programs),
      this.exams.namesByCode(student.enrolledExams),
      student.currentBranchId === null ? null : this.branches.nameOf(student.currentBranchId),
    ]);

    return {
      programs: student.programs.map((code) => ({ code, name: programs.get(code) ?? code })),
      exams: student.enrolledExams.map((code) => ({ code, name: exams.get(code) ?? code })),
      branch,
    };
  }

  /** A stored profile as the API returns it. */
  private async toProfileView(profile: {
    motherName: string | null;
    fatherName: string | null;
    dob: Date | null;
    email: string | null;
    address: string | null;
    gender: Gender | null;
    photoUrl: string | null;
    aadhaarVerified: boolean;
    panVerified: boolean;
    tenthMarksheetUrl: string | null;
    educationDetails: unknown;
    pastExamHistory: unknown;
  }): Promise<StudentDetail['profile']> {
    return {
      motherName: profile.motherName,
      fatherName: profile.fatherName,
      dob: profile.dob ? fromDateColumn(profile.dob) : null,
      email: profile.email,
      address: profile.address,
      gender: profile.gender,
      photoUrl: await this.signed(profile.photoUrl),
      aadhaarVerified: profile.aadhaarVerified,
      panVerified: profile.panVerified,
      tenthMarksheetUrl: await this.signed(profile.tenthMarksheetUrl),
      // Parsed rather than cast: this is JSON written by an older build or by hand, and a malformed row should read as "nothing recorded" rather than reach a screen that assumes an array.
      educationDetails:
        educationEntrySchema.array().safeParse(profile.educationDetails).data ?? null,
      pastExamHistory: pastExamEntrySchema.array().safeParse(profile.pastExamHistory).data ?? null,
    };
  }

  private async signed(key: string | null): Promise<string | null> {
    if (!key) return null;
    return this.storage.createDownloadUrl(key, DOCUMENT_URL_TTL_SEC);
  }

  // ==========================================================================
  // Writing
  // ==========================================================================

  /** Creates a student before their first login. */
  async create(input: CreateStudentBody): Promise<StudentDetail> {
    const existing = await this.findLiveByMobile(input.mobile);
    if (existing) throw mobileTaken(existing.id);

    if (input.enrolledExams?.length) {
      await this.exams.assertUsable(input.enrolledExams, ENROLLED_EXAMS_FIELD);
    }
    if (input.programs?.length) {
      await this.programs.assertUsable(input.programs, PROGRAMS_FIELD);
    }
    const currentBranchId = await this.placementOf(
      input.studentType,
      input.currentBranchId ?? null,
    );

    const data = {
      mobile: input.mobile,
      fullName: input.fullName ?? null,
      studentType: input.studentType,
      enrolledExams: input.enrolledExams ?? [],
      enrolledCourses: input.enrolledCourses ?? [],
      programs: input.programs ?? [],
      currentBranchId,
    };
    try {
      const student = await this.prisma.student.create({ data, select: { id: true } });
      return await this.detail(student.id);
    } catch (error) {
      // The number went between the check above and this write; the live-unique index chose.
      if (isUniqueViolation(error)) throw mobileTaken();
      throw error;
    }
  }

  /** Every target a patch names has to still be usable before any of it is written. */
  private async assertPatchUsable(
    student: { isTestBlocked: boolean; enrolledExams: string[]; programs: string[] },
    input: UpdateStudentBody,
  ): Promise<void> {
    // Only what the save ADDS: a retired exam or program they still hold must not block taking another off.
    const addedExams = input.enrolledExams
      ? addedTo(student.enrolledExams, input.enrolledExams)
      : [];
    if (input.enrolledExams) this.assertMayEnrol(student, input.enrolledExams);
    if (addedExams.length) await this.exams.assertUsable(addedExams, ENROLLED_EXAMS_FIELD);
    const addedPrograms = input.programs ? addedTo(student.programs, input.programs) : [];
    if (addedPrograms.length) {
      await this.programs.assertUsable(addedPrograms, PROGRAMS_FIELD);
    }
  }

  /** Where a save puts them: a branch named has to fit the type, and an online student naming none sits in the online branch. */
  private async placementOf(
    studentType: StudentType,
    named: string | null,
  ): Promise<string | null> {
    if (named) {
      await this.branches.assertFitsStudent(named, studentType, {
        live: true,
        fieldKey: CURRENT_BRANCH_ID_FIELD,
      });
      return named;
    }
    return studentType === STUDENT_TYPE.ONLINE
      ? this.branches.onlineBranchId(CURRENT_BRANCH_ID_FIELD)
      : null;
  }

  /** The branch as this save LEAVES it, undefined for untouched: a patch naming neither type nor branch is skipped, so a student stored out of agreement can still be renamed. */
  private async branchAfter(
    student: { studentType: StudentType; currentBranchId: string | null },
    input: UpdateStudentBody,
  ): Promise<string | null | undefined> {
    if (input.studentType === undefined && input.currentBranchId === undefined) return undefined;

    const studentType = input.studentType ?? student.studentType;
    if (input.currentBranchId !== undefined || studentType === STUDENT_TYPE.ONLINE) {
      return this.placementOf(studentType, input.currentBranchId ?? null);
    }
    // Only the type moved, and the branch they already sit in has to suit it just as a new one would.
    if (student.currentBranchId) {
      await this.branches.assertFitsStudent(student.currentBranchId, studentType, {
        live: false,
        fieldKey: CURRENT_BRANCH_ID_FIELD,
      });
    }
    return undefined;
  }

  /** A patch: an omitted key is left alone, an explicit null clears the field. */
  async update(id: string, input: UpdateStudentBody): Promise<StudentDetail> {
    const student = await this.requireLive(id);

    await this.assertPatchUsable(student, input);
    const currentBranchId = await this.branchAfter(student, input);

    const profilePatch = input.profile;
    const updatedColumns: Prisma.StudentUncheckedUpdateInput = {
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.studentType === undefined ? {} : { studentType: input.studentType }),
      ...(input.enrolledExams ? { enrolledExams: input.enrolledExams } : {}),
      ...(input.enrolledCourses ? { enrolledCourses: input.enrolledCourses } : {}),
      ...(input.programs ? { programs: input.programs } : {}),
      ...(currentBranchId === undefined ? {} : { currentBranchId }),
      ...(profilePatch
        ? {
            profile: {
              upsert: {
                create: toProfileData(profilePatch),
                update: toProfileData(profilePatch),
              },
            },
          }
        : {}),
    };

    const before = auditFieldsOf(student);
    // The save and the word to the student commit together, so a crash cannot leave one without the other.
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.student.update({
        where: { id, deletedAt: null },
        data: updatedColumns,
        include: { profile: true },
      });

      // Only what was ADDED: an un-enrolment is not news, and the whole array is not what changed.
      const added = addedTo(before.enrolledExams, auditFieldsOf(row).enrolledExams);
      if (added.length > 0) {
        await this.notifications.tell(tx, {
          studentId: id,
          type: NOTIFICATION_TYPE.ENROLLMENT_ADDED,
          title: 'You have been enrolled in a new exam',
          body: `Added: ${added.join(', ')}.`,
          // Named for this write, not the exam: one taken off and added again is news again.
          dedupeKey: `enrolment:${added.join(',')}:${row.updatedAt.toISOString()}`,
        });
      }
      return row;
    }, TX_LIMITS.SHORT);

    const columns = fieldDiff(before, auditFieldsOf(updated), AUDITED_STUDENT_FIELDS);
    const profile = profileChanges(student.profile, updated.profile);
    this.auditContext.setChanged(columns || profile ? { ...columns, ...profile } : null);

    return this.detail(id);
  }

  /** Confirms there is a live student to act on, without reading anything about them. */
  async assertExists(id: string): Promise<void> {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
  }

  /** For the configs module: enrolment is an array of exam CODES, with no relation to follow. */
  countEnrolledIn(code: string): Promise<number> {
    return this.prisma.student.count({ where: { enrolledExams: { has: code } } });
  }

  /** Points a profile at a stored document; a student who is gone or erased is refused by the write itself, and the file goes with the refusal. */
  async saveDocumentKey(id: string, column: ProfileDocumentColumn, key: string): Promise<void> {
    try {
      await this.prisma.student.update({
        where: { id, deletedAt: null },
        data: { profile: { upsert: { create: { [column]: key }, update: { [column]: key } } } },
      });
    } catch (error) {
      if (!isRecordNotFound(error)) throw error;
      // Uploaded before this write, and now nothing points at it: an erasure that already ran will not come back for it.
      await this.storage.remove(key);
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    }
  }

  /** Deactivation is reversible and keeps history; there is no hard delete. */
  async setActive(id: string, isActive: boolean): Promise<StudentDetail> {
    const student = await this.requireLive(id);

    await this.prisma.student.update({ where: { id, deletedAt: null }, data: { isActive } });
    this.auditContext.setChanged(
      fieldDiff(student, { ...student, isActive }, AUDITED_ACTIVE_FIELDS),
    );
    // Only a deactivation must sign them out now; a reactivation revokes nothing.
    if (!isActive) this.events.emit(DOMAIN_EVENTS.STUDENT_DEACTIVATED, { studentId: id });
    return this.detail(id);
  }

  /** Who they sign in as. The old number is kept to find them by, and every session they held ends. */
  async changeMobile(id: string, mobile: string, changedById: string): Promise<StudentDetail> {
    const student = await this.requireLive(id);
    if (student.mobile === mobile) {
      throw new AppException(ErrorCodes.CONFLICT, 'That is already their mobile number', {
        fieldErrors: { [MOBILE_FIELD]: ['Already their number'] },
      });
    }
    const holder = await this.findLiveByMobile(mobile);
    if (holder) throw mobileTaken(holder.id);

    try {
      // Together or not at all: a number that moved without its old one kept cannot be found by it.
      await this.prisma.$transaction(async (tx) => {
        // Guarded by what was read, so an erasure or a second change that landed first moves nothing here.
        const moved = await tx.student.updateMany({
          where: { id, deletedAt: null, mobile: student.mobile },
          data: { mobile },
        });
        if (moved.count === 0) throw new AppException(ErrorCodes.CONFLICT, CHANGED_MEANWHILE);
        await tx.studentMobileHistory.create({
          data: { studentId: id, mobile: student.mobile, changedById },
        });
      }, TX_LIMITS.SHORT);
    } catch (error) {
      // Two changes raced for one number; the live-unique index chose, and the loser reads the same refusal.
      if (isUniqueViolation(error)) throw mobileTaken();
      throw error;
    }

    // Masked: the audit log is not emptied by an erasure, so it never holds a whole number.
    this.auditContext.setChanged({
      [MOBILE_FIELD]: { from: maskedMobile(student.mobile), to: maskedMobile(mobile) },
    });
    // The device that held the old number may not be theirs any more, so nothing stays signed in.
    this.events.emit(DOMAIN_EVENTS.STUDENT_MOBILE_CHANGED, { studentId: id });
    return this.detail(id);
  }

  /** Sign-in is untouched: they keep their history and their session, and cannot start a test. */
  async setTestBlocked(id: string, isTestBlocked: boolean): Promise<StudentDetail> {
    const student = await this.requireLive(id);

    await this.prisma.student.update({ where: { id, deletedAt: null }, data: { isTestBlocked } });
    this.auditContext.setChanged(
      fieldDiff(student, { ...student, isTestBlocked }, AUDITED_TEST_BLOCKED_FIELDS),
    );
    return this.detail(id);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Where every write to one student starts: an erased student's tombstone takes no more of them. */
  private async requireLive(id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    return student;
  }

  /** `mobile` is unique only among live rows, so this is a filtered read, not a lookup by key. */
  private findLiveByMobile(
    mobile: string,
  ): Promise<{ id: string; currentBranchId: string | null } | null> {
    return this.prisma.student.findFirst({
      where: { mobile, deletedAt: null },
      select: { id: true, currentBranchId: true },
    });
  }

  /** Only the exams this save would ADD, so a blocked student can still be un-enrolled. */
  private assertMayEnrol(
    student: { isTestBlocked: boolean; enrolledExams: string[] },
    enrolledExams: string[],
  ): void {
    if (!student.isTestBlocked) return;

    const already = new Set(student.enrolledExams);
    if (!enrolledExams.some((code) => !already.has(code))) return;

    throw new AppException(ErrorCodes.VALIDATION_ERROR, BLOCKED_ENROLMENT_MESSAGE, {
      fieldErrors: { [ENROLLED_EXAMS_FIELD]: [BLOCKED_ENROLMENT_MESSAGE] },
    });
  }

  private toSummary(
    row: {
      id: string;
      mobile: string;
      fullName: string | null;
      studentType: StudentType;
      enrolledExams: string[];
      enrolledCourses: ExamCourse[];
      programs: string[];
      isActive: boolean;
      isTestBlocked: boolean;
      profile: Partial<Record<ReadinessField, unknown>> | null;
      createdAt: Date;
    },
    hasOwnAccess: boolean,
  ): StudentSummary {
    return {
      id: row.id,
      mobile: row.mobile,
      fullName: row.fullName,
      studentType: row.studentType,
      enrolledExams: row.enrolledExams,
      enrolledCourses: row.enrolledCourses,
      programs: row.programs,
      hasOwnAccess,
      isActive: row.isActive,
      isTestBlocked: row.isTestBlocked,
      ...readinessOf(row.profile),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** One refusal for a number a live student already signs in with, whichever write met it. */
function mobileTaken(studentId?: string): AppException {
  return new AppException(ErrorCodes.CONFLICT, 'A student with that mobile number already exists', {
    fieldErrors: { [MOBILE_FIELD]: ['Already registered'] },
    ...(studentId ? { details: { studentId } } : {}),
  });
}

/** Every column `AUDITED_STUDENT_FIELDS` names, and nothing else. */
interface AuditedStudentColumns {
  fullName: string | null;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledCourses: ExamCourse[];
  programs: string[];
  currentBranchId: string | null;
  isActive: boolean;
  isTestBlocked: boolean;
}

/** The audited columns off a real row, so a relation write in the update payload can never be diffed as if it were one. The shape admins and questions already use. */
function auditFieldsOf(row: AuditedStudentColumns): AuditedStudentColumns {
  return {
    fullName: row.fullName,
    studentType: row.studentType,
    enrolledExams: row.enrolledExams,
    enrolledCourses: row.enrolledCourses,
    programs: row.programs,
    currentBranchId: row.currentBranchId,
    isActive: row.isActive,
    isTestBlocked: row.isTestBlocked,
  };
}

type AuditedProfileColumns = Partial<Record<(typeof AUDITED_PROFILE_FIELDS)[number], unknown>>;

/** Which profile fields a save moved — set, cleared or changed — and never a value: the audit log outlives an erasure. */
export function profileChanges(
  before: AuditedProfileColumns | null,
  after: AuditedProfileColumns | null,
): FieldDiff | null {
  const moved = fieldDiff(before, after ?? {}, AUDITED_PROFILE_FIELDS);
  if (!moved) return null;
  const withheld = (value: unknown) => (value === null ? null : WITHHELD);
  return Object.fromEntries(
    Object.entries(moved).map(([field, { from, to }]) => [
      field,
      { from: withheld(from), to: withheld(to) },
    ]),
  );
}

function addedTo(before: string[], after: string[]): string[] {
  const held = new Set(before);
  return after.filter((code) => !held.has(code));
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function toProfileData(patch: NonNullable<UpdateStudentBody['profile']>) {
  const data = stripUndefined(patch);
  return {
    ...data,
    // Prisma wants a Date for a DATE column; the wire format is a plain day.
    ...(data.dob === undefined ? {} : { dob: data.dob === null ? null : toDateColumn(data.dob) }),
  };
}
