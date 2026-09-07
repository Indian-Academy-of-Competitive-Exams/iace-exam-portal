import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type Notification,
  type NotificationListQuery,
  type NotificationType,
  type Paginated,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { escalationFor } from './notification-policy';

/** What one notification is written from. `testSeriesId` is the deep link, not decoration. */
export interface NewNotification {
  studentId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** Template variables, so any channel can render this row without the producer being present. */
  data?: Record<string, string | number>;
  /** The natural key of the fact behind it. Given one, writing twice is writing once. */
  dedupeKey?: string;
  /** When this stops being actionable. Given one, escalation stops waiting as it approaches. */
  actBy?: Date;
  testId?: string;
  testSeriesId?: string;
}

interface NotificationColumns {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  testId: string | null;
  testSeriesId: string | null;
  isRead: boolean;
  createdAt: Date;
}

/** Owns `Notification` (docs/03 §5) — what the platform told one student, and whether they read it. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Books what policy allows to be spent; idempotent on dedupeKey so the outbox may redeliver. */
  async create(input: NewNotification): Promise<Notification> {
    const plan = escalationFor(input.type, input.actBy ?? null, new Date());

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.notification.create({
          data: {
            studentId: input.studentId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            data: input.data ?? Prisma.DbNull,
            dedupeKey: input.dedupeKey ?? null,
            actBy: input.actBy ?? null,
            testId: input.testId ?? null,
            testSeriesId: input.testSeriesId ?? null,
          },
        });

        if (plan.channels.length > 0) {
          await tx.notificationDelivery.createMany({
            data: plan.channels.map((channel) => ({ notificationId: created.id, channel })),
          });
        }
        return created;
      });

      return toNotification(row);
    } catch (error) {
      const already = isUniqueViolation(error) ? await this.byDedupeKey(input) : null;
      if (!already) throw error;

      return toNotification(already);
    }
  }

  /** Only ever reached after a unique violation, so the row it looks for is already there. */
  private async byDedupeKey(input: NewNotification): Promise<NotificationColumns | null> {
    if (!input.dedupeKey) return null;

    return this.prisma.notification.findFirst({
      where: { studentId: input.studentId, dedupeKey: input.dedupeKey },
    });
  }

  /** Null for a student who has been anonymised or removed — nothing to text, and nothing wrong. */
  async mobileOf(studentId: string): Promise<string | null> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { mobile: true },
    });
    return student?.mobile ?? null;
  }

  /** One student's own bell, newest first. The id is never taken from the request. */
  async list(studentId: string, query: NotificationListQuery): Promise<Paginated<Notification>> {
    const where: Prisma.NotificationWhereInput = {
      studentId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items: rows.map(toNotification), page: query.page, pageSize: query.pageSize, total };
  }

  /** Scoped by student, so somebody else's id in the path finds nothing rather than their row. */
  async markRead(studentId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({ where: { id, studentId } });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such notification');
    if (row.isRead) return toNotification(row);

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
    return toNotification(updated);
  }
}

function toNotification(row: NotificationColumns): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    testId: row.testId,
    testSeriesId: row.testSeriesId,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}
