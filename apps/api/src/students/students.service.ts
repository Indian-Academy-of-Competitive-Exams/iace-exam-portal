import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
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
 * Owns `Student` and `StudentProfile` (docs/03 §5) — the only module that
 * writes them, `imports` excepted (see its own note; a bulk roster is one
 * statement per file rather than per row).
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

    // One round trip for the rows and one for the count. The count is what
    // makes "page 4 of 37" possible, and it is the half that gets expensive
    // first — revisit with a keyset cursor if a branch ever outgrows it.
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

  /**
   * A stored profile as the API returns it.
   *
   * The three document columns hold object KEYS, not URLs. The bucket is
   * private, so a key is unopenable by a browser — every read swaps them for
   * short-lived signed links, and nothing anywhere holds a permanent URL to
   * somebody's Aadhaar.
   */
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
      // Parsed rather than cast: this is JSON written by an older build or by
      // hand, and a malformed row should read as "nothing recorded" rather than
      // reach a screen that assumes an array.
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

  /**
   * Confirms there is a student to act on, without reading anything about them.
   *
   * Exists so a caller can check BEFORE doing expensive work it would then have
   * to undo — `me` calls it ahead of pushing a file to S3, rather than
   * discovering the student is gone once the object is already stored.
   */
  async assertExists(id: string): Promise<void> {
    const student = await this.prisma.student.findUnique({ where: { id }, select: { id: true } });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
  }

  /**
   * Points a profile at a stored document and recomputes `profileCompleted`.
   *
   * The write lives here rather than in whoever handled the upload because
   * `StudentProfile` is this module's table (docs/03 §5), and `profileCompleted`
   * is a STORED column: a second writer that set the column but not the flag
   * would leave a student who has just uploaded their last document still being
   * nudged to upload it.
   *
   * The flag is recomputed from the merged profile, not from the one column
   * this call touched — see `update` above, which does the same for the same
   * reason.
   */
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
      // The hash itself never leaves this method — only whether one exists.
      // A PIN the INSTITUTE set is not a sign-in. Counting it as one would
      // turn "never signed in" — the list of people to chase — into "was never
      // imported", the moment the first roster is uploaded.
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
