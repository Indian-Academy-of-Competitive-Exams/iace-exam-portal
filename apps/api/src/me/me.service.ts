import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type DocumentKind,
  type Me,
  type StudentCatalog,
  type StudentDetail,
  type UpdateMeBody,
} from '@iace/contracts';
import { StorageService } from '../storage/storage.service';
import { StudentsService } from '../students';
import { AccessResolverService } from '../access';
import { AuditContext } from '../audit';
import { checkDocument, columnFor, documentKey } from './documents';

/** The student's own account. */
@Injectable()
export class MeService {
  constructor(
    private readonly students: StudentsService,
    private readonly storage: StorageService,
    private readonly access: AccessResolverService,
    private readonly auditContext: AuditContext,
  ) {}

  profile(studentId: string): Promise<Me> {
    return this.students.detail(studentId).then((student) => this.withEnrolment(student));
  }

  /** Where a student reads their own standing: codes resolved to names, and never editable here. */
  private async withEnrolment(student: StudentDetail): Promise<Me> {
    return { ...student, enrolment: await this.students.enrolmentOf(student) };
  }

  catalog(studentId: string): Promise<StudentCatalog> {
    return this.access.catalog(studentId);
  }

  /** An enrolment cannot arrive here — see updateMeSchema for why. */
  async update(studentId: string, input: UpdateMeBody): Promise<Me> {
    const updated = await this.students.update(studentId, input);

    // The path carries no `:id`; the diff is the one `StudentsService.update` filed, which names a personal field and withholds what it held.
    this.auditContext.setEntityId(studentId);

    return this.withEnrolment(updated);
  }

  /** Stores an uploaded document and points the profile column for its kind at it. */
  async saveDocument(
    studentId: string,
    kind: DocumentKind,
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
  ): Promise<Me> {
    const contentType = checkDocument(file, kind);
    if (!file) throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to upload');

    // Before the upload, not after: an object pushed to S3 for a student who no longer exists is one nothing will ever read or clean up.
    await this.students.assertExists(studentId);

    const key = documentKey(studentId, kind, contentType, Date.now());
    await this.storage.upload(key, file.buffer, contentType);

    // The write belongs to the module that owns the table.
    await this.students.saveDocumentKey(studentId, columnFor(kind), key);

    // The path is `documents/:kind`, not `:id` — the interceptor's id fallback has no path param to find here, so the entity has to be named explicitly.
    this.auditContext.setEntityId(studentId);

    return this.profile(studentId);
  }
}
