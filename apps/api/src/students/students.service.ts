import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CreateStudentBody,
  type Paginated,
  type StudentDetail,
  type StudentListQuery,
  type StudentSummary,
  type UpdateStudentBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isPreTestReady, isProfileCompleted } from './student-flags';

/** Exactly what the summary and detail views need — nothing else is read. */
const STUDENT_INCLUDE = {
  groups: {
    // The branch comes with the group: a group name is unique only within its
    // branch, so on its own it does not say which group this is.
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }],
  },
} as const satisfies Prisma.StudentInclude;

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // Reading
  // ==========================================================================

  async list(query: StudentListQuery): Promise<Paginated<StudentSummary>> {
    const where = this.whereFrom(query);
    const skip = (query.page - 1) * query.pageSize;

    // One round trip for the rows and one for the count. The count is what
    // makes "page 4 of 37" possible, and it is the half that gets expensive
    // first — revisit with a keyset cursor if a branch ever outgrows it.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        include: STUDENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      profile: student.profile
        ? {
            motherName: student.profile.motherName,
            fatherName: student.profile.fatherName,
            dob: student.profile.dob ? toDateOnly(student.profile.dob) : null,
            email: student.profile.email,
            address: student.profile.address,
            gender: student.profile.gender,
            photoUrl: student.profile.photoUrl,
            educationDetails: student.profile.educationDetails ?? null,
            pastExamHistory: student.profile.pastExamHistory ?? null,
            // aadhaarUrl / panUrl are NOT read here. The contract has no room
            // for them, and reading a field only to drop it is how it ends up
            // in a log line or a debug response later.
          }
        : null,
    };
  }

  // ==========================================================================
  // Writing
  // ==========================================================================

  /**
   * Creates a student before their first login. `mobile` is the join key: when
   * they eventually sign up, the OTP flow upserts on it and finds THIS row, so
   * their group membership is already in place rather than lost to a duplicate.
   */
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

  /**
   * A patch: an omitted key is left alone, an explicit null clears the field.
   * The two are different on purpose — "I did not touch the address" and "the
   * address is wrong, remove it" must not collapse into the same request.
   */
  async update(id: string, input: UpdateStudentBody): Promise<StudentDetail> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { profile: true, groups: { select: { id: true } } },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    if (input.groupIds) {
      // The rule is "do not strip a student's LAST group", not "every student
      // must have one". A self-signed-up student has none until an admin
      // assigns them, and refusing unconditionally made their record
      // unsaveable — an admin could not even correct their name without
      // picking a group they may not know yet.
      if (input.groupIds.length === 0 && student.groups.length > 0) {
        throw new AppException(
          ErrorCodes.VALIDATION_ERROR,
          'A student must stay in at least one group',
          { fieldErrors: { groupIds: ['Pick at least one group'] } },
        );
      }
      await this.assertGroupsExist(input.groupIds);
    }

    const profilePatch = input.profile;
    const nextProfile = profilePatch
      ? { ...(student.profile ?? {}), ...stripUndefined(profilePatch) }
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

  private whereFrom(query: StudentListQuery): Prisma.StudentWhereInput {
    const search = query.q?.trim();

    return {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.groupId ? { groups: { some: { id: query.groupId } } } : {}),
      ...(query.neverSignedIn === undefined
        ? {}
        : { pinHash: query.neverSignedIn ? null : { not: null } }),
      ...(search
        ? {
            OR: [
              { mobile: { contains: search } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
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
      // The hash itself never leaves this method — only whether one exists.
      hasSignedIn: row.pinHash !== null,
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
