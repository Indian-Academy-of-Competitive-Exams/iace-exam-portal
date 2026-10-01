/**
 * The DPDP right the platform answers: erasure. It is about ONE student, and the id is always one
 * an admin's branch scope already reaches.
 */
import { Injectable } from '@nestjs/common';
import { AppException, ErrorCodes, type ErasureReceipt } from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { StorageService } from '../storage/storage.service';
import { anonymizedProfile, anonymizedStudent } from './anonymize';

const NO_STUDENT = 'No such student';

/** The two columns that hold an S3 key rather than a value, and so outlive the row unless removed. */
type DocumentKeys = { photoUrl: string | null; tenthMarksheetUrl: string | null };

@Injectable()
export class StudentPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    private readonly storage: StorageService,
  ) {}

  /** One transaction: a nameless student whose profile still holds their mother's is worse than both. */
  async anonymize(studentId: string): Promise<ErasureReceipt> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        anonymizedAt: true,
        profile: { select: { photoUrl: true, tenthMarksheetUrl: true } },
      },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
    if (student.anonymizedAt) {
      throw new AppException(ErrorCodes.CONFLICT, 'That student has already been erased');
    }

    // Before the row, never after: an erasure that answered success must not have left the files behind.
    await this.forgetDocuments(student.profile);

    const at = new Date();
    const attemptsKept = await this.prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id: studentId }, data: anonymizedStudent(at) });
      await tx.studentProfile.updateMany({ where: { studentId }, data: anonymizedProfile() });
      return tx.attempt.count({ where: { studentId } });
    }, TX_LIMITS.SHORT);

    // An erased account keeps no session: this writes `isActive` itself, so `setActive` never sees it.
    this.events.emit(DOMAIN_EVENTS.STUDENT_DEACTIVATED, { studentId });

    return { studentId, anonymizedAt: at.toISOString(), attemptsKept };
  }

  /** S3 deletes are idempotent, so a retry after a part-way failure asks again and is clean. */
  private async forgetDocuments(profile: DocumentKeys | null): Promise<void> {
    const keys = [profile?.photoUrl, profile?.tenthMarksheetUrl].filter(
      (key): key is string => key !== null && key !== undefined,
    );
    await Promise.all(keys.map((key) => this.storage.remove(key)));
  }
}
