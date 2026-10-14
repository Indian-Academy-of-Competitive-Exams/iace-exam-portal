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
import { pageArgs, paged } from '../common/pagination';
import { withinInstituteDays } from '../common/time/institute-day';
import { PrismaService } from '../prisma/prisma.service';

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
  /** The announcement this belongs to. Its paidChannels become this message's fallback chain. */
  announcementId?: string;
  /** When this stops being actionable. Nothing sets one yet, so escalation never skips the wait. */
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

  /** Written with the caller's transaction, so the fact and the bell row commit together; the push sweep finds it after. */
  async tell(db: Prisma.TransactionClient, ...inputs: readonly NewNotification[]): Promise<void> {
    // skipDuplicates on the dedupe key is what makes a replayed fact land once.
    await db.notification.createMany({ data: inputs.map(toRow), skipDuplicates: true });
  }

  /** Null for a student who has been anonymised or removed — nothing to text, and nothing wrong. */
  async mobileOf(studentId: string): Promise<string | null> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { mobile: true },
    });
    return student?.mobile ?? null;
  }

  /** One student's own bell, newest first; a cursor pages after that row, not by position. The student id is never taken from the request. */
  async list(studentId: string, query: NotificationListQuery): Promise<Paginated<Notification>> {
    const where: Prisma.NotificationWhereInput = { studentId, AND: narrowedBy(query) };

    // The cursor row is excluded by id, not `skip: 1`: once read it leaves the unread filter and skip would eat the next row.
    const page: Prisma.NotificationFindManyArgs = query.cursor
      ? {
          where: { ...where, id: { not: query.cursor } },
          cursor: { id: query.cursor },
          take: query.pageSize,
        }
      : { where, ...pageArgs(query) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        ...page,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paged(query, rows.map(toNotification), total);
  }

  /** Scoped by student, so somebody else's id in the path finds nothing rather than their row. */
  async markRead(studentId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({ where: { id, studentId } });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such notification');
    if (row.isRead) return toNotification(row);

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return toNotification(updated);
  }
}

/** Every filter the bell is read through; an empty list narrows nothing. */
function narrowedBy(query: NotificationListQuery): Prisma.NotificationWhereInput[] {
  const filters: Prisma.NotificationWhereInput[] = [];
  if (query.unreadOnly) filters.push(unreadAsOf(query.unreadAsOf));
  if (query.type) filters.push({ type: { in: query.type } });
  if (query.from || query.to)
    filters.push({ createdAt: withinInstituteDays(query.from, query.to) });
  if (query.q)
    filters.push({ OR: [{ title: textHolding(query.q) }, { body: textHolding(query.q) }] });
  return filters;
}

const textHolding = (q: string) => ({ contains: q, mode: 'insensitive' }) as const;

const unreadAsOf = (asOf: string | undefined): Prisma.NotificationWhereInput =>
  asOf ? { OR: [{ isRead: false }, { readAt: { gt: new Date(asOf) } }] } : { isRead: false };

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

function toRow(input: NewNotification): Prisma.NotificationCreateManyInput {
  return {
    studentId: input.studentId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    data: input.data ?? Prisma.DbNull,
    dedupeKey: input.dedupeKey ?? null,
    announcementId: input.announcementId ?? null,
    actBy: input.actBy ?? null,
    testId: input.testId ?? null,
    testSeriesId: input.testSeriesId ?? null,
  };
}
