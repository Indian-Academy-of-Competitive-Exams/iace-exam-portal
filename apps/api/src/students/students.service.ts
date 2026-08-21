import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  AppException,
  BLOCKED_ENROLMENT_MESSAGE,
  ErrorCodes,
  educationEntrySchema,
  fieldDiff,
  pastExamEntrySchema,
  type ExamFamily,
  type Gender,
  type CreateStudentBody,
  type Paginated,
  type StudentDetail,
  type StudentListQuery,
  type StudentSummary,
  type StudentType,
  type UpdateStudentBody,
} from '@iace/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthService, defaultPinFor } from '../auth';
import { BranchesService } from '../branches';
import { ExamsService } from '../configs';
import { type ProgramsService } from '../access';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';

/** How long a signed link to somebody's photo stays usable. */
const DOCUMENT_URL_TTL_SEC = 300;
import { studentOrderBy, studentWhere } from './student-query';
import { isPreTestReady, isProfileCompleted, type ProfileDocumentColumn } from './student-flags';
import { fromDateColumn, toDateColumn } from '../common/time/institute-day';

/** The `fieldErrors` keys the student forms own — `applyFieldErrors` drops any other. */
const ENROLLED_EXAMS_FIELD = 'enrolledExams';
const PROGRAMS_FIELD = 'programs';
const CURRENT_BRANCH_ID_FIELD = 'currentBranchId';

/** What a student's audit diff covers — every column the admin screens can change. */
export const AUDITED_STUDENT_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'enrolledFamilies',
  'programs',
  'currentBranchId',
  'isActive',
  'isTestBlocked',
] as const;

/** The single column each toggle route moves — the same `fieldDiff` definition of "changed". */
const AUDITED_ACTIVE_FIELDS = ['isActive'] as const;
const AUDITED_TEST_BLOCKED_FIELDS = ['isTestBlocked'] as const;

/** The columns a student's catalog is resolved from — moving one makes their cached answer wrong. */
const ACCESS_STUDENT_FIELDS = [
  'enrolledExams',
  'programs',
  'currentBranchId',
  'isTestBlocked',
] as const;

/**
 * Owns `Student` and `StudentProfile` (docs/03 §5) — the only module that writes them, `imports`
 * excepted (see its own note; a bulk roster is one statement per file rather than per row).
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => ExamsService))
    private readonly exams: ExamsService,
    private readonly branches: BranchesService,
    private readonly auth: AuthService,
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
  ) {}

  // ==========================================================================
  // Reading
  // ==========================================================================

  async list(query: StudentListQuery): Promise<Paginated<StudentSummary>> {
    const where = studentWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    // One round trip for the rows and one for the count.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        orderBy: studentOrderBy(query.sort),
        skip,
        take: query.pageSize,
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    return {
      ...this.toSummary(student),
      programs: student.programs,
      currentBranchId: student.currentBranchId,
      updatedAt: student.updatedAt.toISOString(),
      profile: student.profile ? await this.toProfileView(student.profile) : null,
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
      // Parsed rather than cast: this is JSON written by an older build or by hand, and a malformed row
      // should read as "nothing recorded" rather than reach a screen that assumes an array.
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
    if (existing) {
      throw new AppException(
        ErrorCodes.CONFLICT,
        'A student with that mobile number already exists',
        {
          fieldErrors: { mobile: ['Already registered'] },
          details: { studentId: existing.id },
        },
      );
    }

    if (input.enrolledExams?.length) {
      await this.exams.assertUsable(input.enrolledExams, ENROLLED_EXAMS_FIELD);
    }
    if (input.programs?.length) {
      await this.programs.assertUsable(input.programs, PROGRAMS_FIELD);
    }
    if (input.currentBranchId) {
      await this.branches.assertUsable(input.currentBranchId, CURRENT_BRANCH_ID_FIELD);
      await this.branches.assertSuitsStudentType(
        input.currentBranchId,
        input.studentType,
        CURRENT_BRANCH_ID_FIELD,
      );
    }

    const student = await this.prisma.student.create({
      data: {
        mobile: input.mobile,
        fullName: input.fullName ?? null,
        studentType: input.studentType,
        enrolledExams: input.enrolledExams ?? [],
        enrolledFamilies: input.enrolledFamilies ?? [],
        programs: input.programs ?? [],
        currentBranchId: input.currentBranchId ?? null,
        // The same starting PIN the importer gives, so a student added by hand can sign in today.
        pinHash: await this.auth.hashPin(defaultPinFor(input.mobile)),
        pinIsDefault: true,
      },
    });
    return this.detail(student.id);
  }

  /** Every target a patch names has to still be usable before any of it is written. */
  private async assertPatchUsable(
    student: {
      isTestBlocked: boolean;
      enrolledExams: string[];
      studentType: StudentType;
      currentBranchId: string | null;
    },
    input: UpdateStudentBody,
  ): Promise<void> {
    if (input.enrolledExams) {
      this.assertMayEnrol(student, input.enrolledExams);
      if (input.enrolledExams.length) {
        await this.exams.assertUsable(input.enrolledExams, ENROLLED_EXAMS_FIELD);
      }
    }
    if (input.programs?.length) {
      await this.programs.assertUsable(input.programs, PROGRAMS_FIELD);
    }
    await this.assertBranchSuitsPatch(student, input);
  }

  /**
   * The pair as this save would LEAVE it, not the half the request named — flipping only the type
   * moves an existing branch out of agreement just as surely as picking a new branch does. Skipped
   * when the patch touches neither, so a student already stored incoherently can still be renamed.
   */
  private async assertBranchSuitsPatch(
    student: { studentType: StudentType; currentBranchId: string | null },
    input: UpdateStudentBody,
  ): Promise<void> {
    const named = input.currentBranchId;
    if (named) await this.branches.assertUsable(named, CURRENT_BRANCH_ID_FIELD);

    if (input.studentType === undefined && named === undefined) return;

    const branchId = named === undefined ? student.currentBranchId : named;
    if (!branchId) return;

    await this.branches.assertSuitsStudentType(
      branchId,
      input.studentType ?? student.studentType,
      CURRENT_BRANCH_ID_FIELD,
    );
  }

  /** A patch: an omitted key is left alone, an explicit null clears the field. */
  async update(id: string, input: UpdateStudentBody): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.assertPatchUsable(student, input);

    const profilePatch = input.profile;
    // Spread of the EXISTING profile then the patch: readiness is decided on
    // the merged result, not on the handful of fields this request touched.
    const nextProfile = profilePatch
      ? { ...student.profile, ...stripUndefined(profilePatch) }
      : student.profile;

    const updatedColumns: Prisma.StudentUncheckedUpdateInput = {
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.studentType === undefined ? {} : { studentType: input.studentType }),
      ...(input.enrolledExams ? { enrolledExams: input.enrolledExams } : {}),
      ...(input.enrolledFamilies ? { enrolledFamilies: input.enrolledFamilies } : {}),
      ...(input.programs ? { programs: input.programs } : {}),
      ...(input.currentBranchId === undefined ? {} : { currentBranchId: input.currentBranchId }),
      ...(profilePatch
        ? {
            profile: {
              upsert: {
                create: toProfileData(profilePatch),
                update: toProfileData(profilePatch),
              },
            },
            // Recomputed from the MERGED profile, not the patch: editing only
            // the mother's name must not decide readiness on that field alone.
            preTestReady: isPreTestReady(nextProfile as never),
            profileCompleted: isProfileCompleted(nextProfile as never),
          }
        : {}),
    };

    const updated = await this.prisma.student.update({ where: { id }, data: updatedColumns });

    const before = auditFieldsOf(student);
    const after = auditFieldsOf(updated);
    this.auditContext.setChanged(fieldDiff(before, after, AUDITED_STUDENT_FIELDS));
    if (fieldDiff(before, after, ACCESS_STUDENT_FIELDS)) {
      this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId: id });
    }

    // Only what was ADDED: an un-enrolment is not news, and the whole array is not what changed.
    const examCodes = addedTo(before.enrolledExams, after.enrolledExams);
    if (examCodes.length > 0) {
      this.events.emit(DOMAIN_EVENTS.STUDENT_ENROLMENT_ADDED, { studentId: id, examCodes });
    }

    return this.detail(id);
  }

  /** Confirms there is a student to act on, without reading anything about them. */
  async assertExists(id: string): Promise<void> {
    const student = await this.prisma.student.findUnique({ where: { id }, select: { id: true } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
  }

  /** For the configs module: enrolment is an array of exam CODES, with no relation to follow. */
  countEnrolledIn(code: string): Promise<number> {
    return this.prisma.student.count({ where: { enrolledExams: { has: code } } });
  }

  /** Points a profile at a stored document and recomputes `profileCompleted`. */
  async saveDocumentKey(id: string, column: ProfileDocumentColumn, key: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const nextProfile = { ...student.profile, [column]: key };

    await this.prisma.student.update({
      where: { id },
      data: {
        profile: {
          upsert: { create: { [column]: key }, update: { [column]: key } },
        },
        profileCompleted: isProfileCompleted(nextProfile as never),
      },
    });
  }

  /** Deactivation is reversible and keeps history; there is no hard delete. */
  async setActive(id: string, isActive: boolean): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.prisma.student.update({ where: { id }, data: { isActive } });
    this.auditContext.setChanged(
      fieldDiff(student, { ...student, isActive }, AUDITED_ACTIVE_FIELDS),
    );
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId: id });
    return this.detail(id);
  }

  /** Sign-in is untouched: they keep their history and their session, and cannot start a test. */
  async setTestBlocked(id: string, isTestBlocked: boolean): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: { id: true, isTestBlocked: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.prisma.student.update({ where: { id }, data: { isTestBlocked } });
    this.auditContext.setChanged(
      fieldDiff(student, { ...student, isTestBlocked }, AUDITED_TEST_BLOCKED_FIELDS),
    );
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId: id });
    return this.detail(id);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** `mobile` is unique only among live rows, so this is a filtered read, not a lookup by key. */
  private findLiveByMobile(mobile: string): Promise<{ id: string } | null> {
    return this.prisma.student.findFirst({
      where: { mobile, deletedAt: null },
      select: { id: true },
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

  private toSummary(row: {
    id: string;
    mobile: string;
    fullName: string | null;
    studentType: StudentType;
    enrolledExams: string[];
    enrolledFamilies: ExamFamily[];
    isActive: boolean;
    isTestBlocked: boolean;
    pinHash: string | null;
    pinIsDefault: boolean;
    preTestReady: boolean;
    profileCompleted: boolean;
    createdAt: Date;
  }): StudentSummary {
    return {
      id: row.id,
      mobile: row.mobile,
      fullName: row.fullName,
      studentType: row.studentType,
      enrolledExams: row.enrolledExams,
      enrolledFamilies: row.enrolledFamilies,
      isActive: row.isActive,
      isTestBlocked: row.isTestBlocked,
      // The hash itself never leaves this method — only whether one exists. A PIN the INSTITUTE set is
      // not a sign-in.
      hasSignedIn: row.pinHash !== null && !row.pinIsDefault,
      hasDefaultPin: row.pinIsDefault,
      preTestReady: row.preTestReady,
      profileCompleted: row.profileCompleted,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Every column `AUDITED_STUDENT_FIELDS` names, and nothing else. */
interface AuditedStudentColumns {
  fullName: string | null;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledFamilies: ExamFamily[];
  programs: string[];
  currentBranchId: string | null;
  isActive: boolean;
  isTestBlocked: boolean;
}

/** The audited columns off a real row, so a relation write in the update payload can never be
 *  diffed as if it were one. The shape admins and questions already use. */
function auditFieldsOf(row: AuditedStudentColumns): AuditedStudentColumns {
  return {
    fullName: row.fullName,
    studentType: row.studentType,
    enrolledExams: row.enrolledExams,
    enrolledFamilies: row.enrolledFamilies,
    programs: row.programs,
    currentBranchId: row.currentBranchId,
    isActive: row.isActive,
    isTestBlocked: row.isTestBlocked,
  };
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
