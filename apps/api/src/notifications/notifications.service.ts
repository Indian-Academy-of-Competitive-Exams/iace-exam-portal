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

/** What one notification is written from. `testSeriesId` is the deep link, not decoration. */
export interface NewNotification {
  studentId: string;
  type: NotificationType;
  title: string;
  body?: string;
  testId?: string;
  testSeriesId?: string;
}

interface NotificationColumns {
  id: string;
  studentId: string;
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

  async create(input: NewNotification): Promise<Notification> {
    const row = await this.prisma.notification.create({
      data: {
        studentId: input.studentId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        testId: input.testId ?? null,
        testSeriesId: input.testSeriesId ?? null,
      },
    });
    return toNotification(row);
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
    studentId: row.studentId,
    type: row.type,
    title: row.title,
    body: row.body,
    testId: row.testId,
    testSeriesId: row.testSeriesId,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}
