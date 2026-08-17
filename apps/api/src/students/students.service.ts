import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  deactivatedMemberBlocker,
  educationEntrySchema,
  pastExamEntrySchema,
  type Gender,
  type CreateStudentBody,
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

/** Exactly what the summary and detail views need — nothing else is read. */
const STUDENT_INCLUDE = {
  groups: {
    // The branch comes with the group: a group name is unique only within its
    // branch, so on its own it does not say which group this is.
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
  },
} as const satisfies Prisma.StudentInclude;

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
        include: STUDENT_INCLUDE,
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
      include: { ...STUDENT_INCLUDE, profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    return {
      ...this.toSummary(student),
      preferredLanguage: student.preferredLanguage,
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
        ...(input.groupIds?.length
          ? { groups: { connect: input.groupIds.map((id) => ({ id })) } }
          : {}),
      },
    });
    return this.detail(student.id);
  }

  /** A patch: an omitted key is left alone, an explicit null clears the field. */
  async update(id: string, input: UpdateStudentBody): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true, groups: { select: { id: true } } },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (input.groupIds) {
      // The rule is "do not strip a student's LAST group", not "every student must have one".
      if (input.groupIds.length === 0 && student.groups.length > 0) {
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
        ...(input.groupIds ? { groups: { set: input.groupIds.map((gid) => ({ id: gid })) } } : {}),
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
    student: { isActive: boolean; groups: { id: string }[] },
    groupIds: string[],
  ): void {
    if (student.isActive) return;

    const already = new Set(student.groups.map((group) => group.id));
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

  private toSummary(row: {
    id: string;
    mobile: string;
    fullName: string | null;
    isActive: boolean;
    pinHash: string | null;
    pinIsDefault: boolean;
    preTestReady: boolean;
    profileCompleted: boolean;
    createdAt: Date;
    groups: { id: string; name: string; branch: { name: string } }[];
  }): StudentSummary {
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
      groups: row.groups.map((group) => ({
        id: group.id,
        name: group.name,
        branchName: group.branch.name,
      })),
      createdAt: row.createdAt.toISOString(),
    };
  }
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
