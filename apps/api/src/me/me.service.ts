import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type DocumentKind,
  type Me,
  type UpdateMeBody,
} from '@iace/contracts';
import { StorageService } from '../storage/storage.service';
import { StudentsService } from '../students';
import { AuditContext } from '../audit';
import { checkDocument, columnFor, documentKey } from './documents';

/** What a student's own profile edit covers — the fields a pre-test prompt asks for, plus contact
 * details. Narrower than `AUDITED_STUDENT_FIELDS`: this route cannot touch enrolment or branch. */
export const AUDITED_PROFILE_FIELDS = [
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
] as const;

/** The student's own account. */
@Injectable()
export class MeService {
  constructor(
    private readonly students: StudentsService,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContext,
  ) {}

  profile(studentId: string): Promise<Me> {
    return this.students.detail(studentId);
  }

  /** An enrolment cannot arrive here — see updateMeSchema for why. */
  async update(studentId: string, input: UpdateMeBody): Promise<Me> {
    const before = await this.students.detail(studentId);
    const updated = await this.students.update(studentId, input);

    const columns = this.auditContext.current()?.changed;
    const profile = updated.profile
      ? fieldDiff(before.profile, updated.profile, AUDITED_PROFILE_FIELDS)
      : null;

    // Merged over `StudentsService.update`'s diff, never replacing it: this route can rename the
    // student too, and replacing it filed that as a change with nothing in it.
    this.auditContext.setEntityId(studentId);
    this.auditContext.setChanged(columns || profile ? { ...columns, ...profile } : null);

    return updated;
  }

  /** Stores an uploaded document and points the profile column for its kind at it. */
  async saveDocument(
    studentId: string,
    kind: DocumentKind,
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
  ): Promise<Me> {
    checkDocument(file, kind);
    if (!file) throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to upload');

    // Before the upload, not after: an object pushed to S3 for a student who
    // no longer exists is one nothing will ever read or clean up.
    await this.students.assertExists(studentId);

    const key = documentKey(studentId, kind, file.mimetype, Date.now());
    await this.storage.upload(key, file.buffer, file.mimetype);

    // The write — and the `profileCompleted` recompute that has to go with it —
    // belongs to the module that owns the table.
    await this.students.saveDocumentKey(studentId, columnFor(kind), key);

    // The path is `documents/:kind`, not `:id` — the interceptor's id fallback
    // has no path param to find here, so the entity has to be named explicitly.
    this.auditContext.setEntityId(studentId);

    return this.profile(studentId);
  }
}
