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

/** The student's own account. */
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

  /** Stores a photo or an identity document and points the profile at it. */
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
