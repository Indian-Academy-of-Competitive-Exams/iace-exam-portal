import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  IMPORT_SOURCE,
  STUDENT_TYPE,
  deactivatedMemberBlocker,
  educationEntrySchema,
  pastExamEntrySchema,
  type Gender,
  type CreateStudentBody,
  type GroupRef,
  type Paginated,
  type StudentDetail,
  type StudentListQuery,
  type StudentSummary,
  type UpdateStudentBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** How long a signed link to somebody's identity document stays usable. */
const DOCUMENT_URL_TTL_SEC = 300;
import { studentOrderBy, studentWhere } from './student-query';
import { isPreTestReady, isProfileCompleted, type ProfileDocumentColumn } from './student-flags';

/** What names a group on a student's row — the group ids themselves are a column. */
const GROUP_REF_SELECT = { id: true, name: true, examType: true } as const;

/**
 * Owns `Student` and `StudentProfile` (docs/03 §5) — the only module that writes them, `imports`
 * excepted (see its own note; a bulk roster is one statement per file rather than per row).
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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

    // One lookup for the whole page, not one per student.
    const named = await this.groupRefs(rows.flatMap((row) => row.directGroupIds));

    return {
      items: rows.map((row) => this.toSummary(row, namesOf(row.directGroupIds, named))),
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

    const named = await this.groupRefs(student.directGroupIds);

    return {
      ...this.toSummary(student, namesOf(student.directGroupIds, named)),
      preferredLanguage: student.preferredLanguage,
      updatedAt: student.updatedAt.toISOString(),
      profile: student.profile ? await this.toProfileView(student.profile) : null,
    };
  }

  /** The groups a set of ids names, by id. A group deleted out from under a grant is simply absent. */
  private async groupRefs(groupIds: string[]): Promise<Map<string, GroupRef>> {
    const wanted = [...new Set(groupIds)];
    if (wanted.length === 0) return new Map();

    const groups = await this.prisma.group.findMany({
      where: { id: { in: wanted } },
      select: GROUP_REF_SELECT,
    });
    return new Map(groups.map((group) => [group.id, group]));
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
    aadhaarUrl: string | null;
    panUrl: string | null;
    educationDetails: unknown;
    pastExamHistory: unknown;
  }): Promise<StudentDetail['profile']> {
    const [photoUrl, aadhaarUrl, panUrl] = await Promise.all([
      this.signed(profile.photoUrl),
      this.signed(profile.aadhaarUrl),
      this.signed(profile.panUrl),
    ]);

    return {
      motherName: profile.motherName,
      fatherName: profile.fatherName,
      dob: profile.dob ? toDateOnly(profile.dob) : null,
      email: profile.email,
      address: profile.address,
      gender: profile.gender,
      photoUrl,
      aadhaarUrl,
      panUrl,
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
    const existing = await this.prisma.student.findUnique({ where: { mobile: input.mobile } });
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

    await this.assertGroupsExist(input.groupIds);

    const student = await this.prisma.student.create({
      data: {
        mobile: input.mobile,
        fullName: input.fullName ?? null,
        // An admin adding one student by hand is adding an online one; the
        // roster import is where the type is chosen per row.
        studentType: STUDENT_TYPE.ONLINE,
        createdVia: IMPORT_SOURCE.INDIVIDUAL,
        directGroupIds: input.groupIds ?? [],
      },
    });
    return this.detail(student.id);
  }

  /** A patch: an omitted key is left alone, an explicit null clears the field. */
  async update(id: string, input: UpdateStudentBody): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (input.groupIds) {
      // The rule is "do not strip a student's LAST group", not "every student must have one".
      if (input.groupIds.length === 0 && student.directGroupIds.length > 0) {
        throw new AppException(
          ErrorCodes.VALIDATION_ERROR,
          'A student must stay in at least one group',
          { fieldErrors: { groupIds: ['Pick at least one group'] } },
        );
      }
      await this.assertGroupsExist(input.groupIds);
      this.assertMayJoinGroups(student, input.groupIds);
    }

    const profilePatch = input.profile;
    // Spread of the EXISTING profile then the patch: readiness is decided on
    // the merged result, not on the handful of fields this request touched.
    const nextProfile = profilePatch
      ? { ...student.profile, ...stripUndefined(profilePatch) }
      : student.profile;

    await this.prisma.student.update({
      where: { id },
      data: {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.preferredLanguage === undefined
          ? {}
          : { preferredLanguage: input.preferredLanguage }),
        ...(input.groupIds ? { directGroupIds: input.groupIds } : {}),
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
      },
    });

    return this.detail(id);
  }

  /** Confirms there is a student to act on, without reading anything about them. */
  async assertExists(id: string): Promise<void> {
    const student = await this.prisma.student.findUnique({ where: { id }, select: { id: true } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
  }

  /** For the configs module: enrolment is an array of exam-type CODES, with no relation to follow. */
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
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    await this.prisma.student.update({ where: { id }, data: { isActive } });
    return this.detail(id);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Only the groups this save would ADD, so a deactivated student can still lose one. */
  private assertMayJoinGroups(
    student: { isActive: boolean; directGroupIds: string[] },
    groupIds: string[],
  ): void {
    if (student.isActive) return;

    const already = new Set(student.directGroupIds);
    const joining = new Set(groupIds.filter((id) => !already.has(id)));
    const blocker = deactivatedMemberBlocker(joining.size > 0 ? 1 : 0);
    if (blocker) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, blocker, {
        fieldErrors: { groupIds: [blocker] },
      });
    }
  }

  private async assertGroupsExist(groupIds: string[] | undefined): Promise<void> {
    if (!groupIds?.length) return;

    const found = await this.prisma.group.count({ where: { id: { in: groupIds } } });
    if (found !== new Set(groupIds).size) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'One of those groups no longer exists', {
        fieldErrors: { groupIds: ['One of those groups no longer exists'] },
      });
    }
  }

  private toSummary(
    row: {
      id: string;
      mobile: string;
      fullName: string | null;
      isActive: boolean;
      pinHash: string | null;
      pinIsDefault: boolean;
      preTestReady: boolean;
      profileCompleted: boolean;
      createdAt: Date;
    },
    groups: GroupRef[],
  ): StudentSummary {
    return {
      id: row.id,
      mobile: row.mobile,
      fullName: row.fullName,
      isActive: row.isActive,
      // The hash itself never leaves this method — only whether one exists. A PIN the INSTITUTE set is
      // not a sign-in.
      hasSignedIn: row.pinHash !== null && !row.pinIsDefault,
      hasDefaultPin: row.pinIsDefault,
      preTestReady: row.preTestReady,
      profileCompleted: row.profileCompleted,
      groups,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** The named groups behind a student's grants, in name order; unknown ids drop out. */
function namesOf(groupIds: string[], named: Map<string, GroupRef>): GroupRef[] {
  return groupIds
    .map((id) => named.get(id))
    .filter((group): group is GroupRef => group !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A DATE column round-trips as YYYY-MM-DD; the time part is not ours to invent. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function toProfileData(patch: NonNullable<UpdateStudentBody['profile']>) {
  const data = stripUndefined(patch);
  return {
    ...data,
    // Prisma wants a Date for a DATE column; the wire format is a plain day.
    ...(data.dob === undefined
      ? {}
      : { dob: data.dob === null ? null : new Date(`${data.dob}T00:00:00Z`) }),
  };
}
