import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type DocumentKind,
  type Me,
  type StudentDetail,
  type UpdateMeBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StudentsService } from '../students/students.service';
import { isProfileCompleted } from '../students/student-flags';
import { checkDocument, columnFor, documentKey } from './documents';

/** How long a signed link to somebody's Aadhaar stays usable. */
const DOCUMENT_URL_TTL_SEC = 300;

/**
 * The student's own account.
 *
 * Every method takes the id from the authenticated caller — never from a path
 * or a body — so there is no request shape that addresses somebody else's
 * record. Reading and editing reuse StudentsService rather than growing a
 * second copy: `preTestReady` and `profileCompleted` are stored columns, and a
 * second write path that forgot to recompute them would leave a student who
 * had just filled in their details still being asked for them.
 *
 * Changing the PIN is NOT here. It is a credential operation — it verifies the
 * old PIN, climbs the lockout ladder, revokes sessions and issues fresh tokens
 * — and all four of those live in AuthService. Reimplementing any of them here
 * is how one of them ends up subtly different from the login that shares it.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly storage: StorageService,
  ) {}

  async profile(studentId: string): Promise<Me> {
    const detail = await this.students.detail(studentId);
    return { ...detail, profile: await this.withDocumentUrls(studentId, detail.profile) };
  }

  /** `groupIds` cannot arrive here — see updateMeSchema for why. */
  async update(studentId: string, input: UpdateMeBody): Promise<Me> {
    const updated = await this.students.update(studentId, input);
    return { ...updated, profile: await this.withDocumentUrls(studentId, updated.profile) };
  }

  /**
   * Stores a photo or an identity document and points the profile at it.
   *
   * The student id comes from the token and is baked into the key, so an upload
   * cannot be written under anyone else's prefix. The old object is deliberately
   * NOT deleted: the write to Postgres can fail after the write to S3, and the
   * previous file is the only thing standing between that and a student whose
   * record points at nothing.
   */
  async saveDocument(
    studentId: string,
    kind: DocumentKind,
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
  ): Promise<Me> {
    checkDocument(kind, file);
    if (!file) throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to upload');

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { profile: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const key = documentKey(studentId, kind, file.mimetype, Date.now());
    await this.storage.upload(key, file.buffer, file.mimetype);

    const column = columnFor(kind);
    const nextProfile = { ...student.profile, [column]: key };

    await this.prisma.student.update({
      where: { id: studentId },
      data: {
        profile: {
          upsert: { create: { [column]: key }, update: { [column]: key } },
        },
        // Recomputed from the merged profile: uploading a photo can be the
        // thing that completes it, and a stale flag means the student is still
        // being nudged for something they have just done.
        profileCompleted: isProfileCompleted(nextProfile as never),
      },
    });

    return this.profile(studentId);
  }

  /**
   * Swaps stored object KEYS for short-lived signed URLs.
   *
   * The bucket is private, so the stored key is not openable by a browser — and
   * a permanent public URL to somebody's Aadhaar is precisely the thing not to
   * put in a JSON response.
   */
  private async withDocumentUrls(
    studentId: string,
    // The ADMIN's profile shape on the way in — it has no document fields, which
    // is exactly what this adds.
    profile: StudentDetail['profile'],
  ): Promise<Me['profile']> {
    if (!profile) return null;

    const stored = await this.prisma.studentProfile.findUnique({
      where: { studentId },
      select: { photoUrl: true, aadhaarUrl: true, panUrl: true },
    });

    return {
      ...profile,
      photoUrl: await this.signed(stored?.photoUrl),
      aadhaarUrl: await this.signed(stored?.aadhaarUrl),
      panUrl: await this.signed(stored?.panUrl),
    };
  }

  private async signed(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    return this.storage.createDownloadUrl(key, DOCUMENT_URL_TTL_SEC);
  }
}
