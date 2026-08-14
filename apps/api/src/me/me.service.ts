import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type DocumentKind,
  type Me,
  type UpdateMeBody,
} from '@iace/contracts';
import { StorageService } from '../storage/storage.service';
import { StudentsService } from '../students';
import { checkDocument, columnFor, documentKey } from './documents';

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
 *
 * Owns NO tables (docs/03 §5). It is an aggregator by design — the student's
 * own view over `students` and `auth` — so every read and every write goes
 * through those modules' facades and none of them touch Prisma from here.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly students: StudentsService,
    private readonly storage: StorageService,
  ) {}

  profile(studentId: string): Promise<Me> {
    return this.students.detail(studentId);
  }

  /** `groupIds` cannot arrive here — see updateMeSchema for why. */
  update(studentId: string, input: UpdateMeBody): Promise<Me> {
    return this.students.update(studentId, input);
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

    // Before the upload, not after: an object pushed to S3 for a student who
    // no longer exists is one nothing will ever read or clean up.
    await this.students.assertExists(studentId);

    const key = documentKey(studentId, kind, file.mimetype, Date.now());
    await this.storage.upload(key, file.buffer, file.mimetype);

    // The write — and the `profileCompleted` recompute that has to go with it —
    // belongs to the module that owns the table.
    await this.students.saveDocumentKey(studentId, columnFor(kind), key);

    return this.profile(studentId);
  }
}
