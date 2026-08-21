import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type GrantSeriesBody,
  type StudentGrantRow,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';

export const BLOCKED_GRANT_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a series.';

/**
 * Owns `StudentGrant` — the escape hatch for access that is not exam-, program- or
 * branch-derivable. One row per (student, series), and it is the ONLY direct student-to-offering
 * link in the model, which is why it is granted one at a time and never in bulk.
 */
@Injectable()
export class StudentGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  async list(studentId: string): Promise<StudentGrantRow[]> {
    await this.requireStudent(studentId);

    const rows = await this.prisma.studentGrant.findMany({
      where: { studentId },
      include: { testSeries: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      studentId: row.studentId,
      testSeriesId: row.testSeriesId,
      testSeries: row.testSeries,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async grant(
    studentId: string,
    input: GrantSeriesBody,
    createdById: string,
  ): Promise<StudentGrantRow[]> {
    const student = await this.requireStudent(studentId);
    if (student.isTestBlocked) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, BLOCKED_GRANT_MESSAGE, {
        fieldErrors: { testSeriesId: [BLOCKED_GRANT_MESSAGE] },
      });
    }

    const series = await this.prisma.testSeries.findUnique({
      where: { id: input.testSeriesId },
      select: { id: true },
    });
    if (!series) {
      const message = 'No such series';
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { testSeriesId: [message] },
      });
    }

    const key = { studentId, testSeriesId: input.testSeriesId };
    const held = await this.prisma.studentGrant.findUnique({
      where: { studentId_testSeriesId: key },
      select: { testSeriesId: true },
    });

    // Granting twice is not an error: the roster it came from is often re-read.
    await this.prisma.studentGrant.upsert({
      where: { studentId_testSeriesId: key },
      create: { ...key, createdById },
      update: {},
    });

    // A grant has no row of its own to name — it is filed against the student it was made about.
    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
    // Only what the grant CHANGED is announced: re-reading a roster must not ring the bell again.
    if (!held) this.events.emit(DOMAIN_EVENTS.SERIES_GRANTED, key);

    return this.list(studentId);
  }

  async revoke(studentId: string, testSeriesId: string): Promise<void> {
    await this.requireStudent(studentId);

    await this.prisma.studentGrant.deleteMany({ where: { studentId, testSeriesId } });
    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  private async requireStudent(id: string): Promise<{ isTestBlocked: boolean }> {
    const student = await this.prisma.student.findUnique({
      where: { id },
      select: { isTestBlocked: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    return student;
  }
}
