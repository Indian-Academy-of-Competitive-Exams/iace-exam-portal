/**
 * One student's bell: their own rows, and the broadcasts that reach them, resolved as it is read.
 * A broadcast — an in-app announcement, a test opening — is one row for everybody, matched here by
 * the announcement's audience or the student's catalog; only a read of one is written per student.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  type AnnouncementAudience,
  type Notification,
  type NotificationListQuery,
  type NotificationType,
  type Paginated,
} from '@iace/contracts';
import { AccessResolverService } from '../reach';
import { paged } from '../common/pagination';
import { MS_PER_DAY } from '../common/time/units';
import { withinInstituteDays } from '../common/time/institute-day';
import { PrismaService } from '../prisma/prisma.service';
import { cohortWhere } from './announcement-cohort';
import { OPENED_TITLE } from './test-opening.service';

/** How far back the bell resolves broadcasts; older ones age out of it rather than being pruned. */
export const BELL_WINDOW_DAYS = 90;

/** ponytail: one audience check per announcement in the window; cache per student if this grows. */
const ANNOUNCEMENTS_MAX = 50;

/** Tests reached in the window; a catalog of series opens far fewer than this in ninety days. */
const OPENINGS_MAX = 200;

export const OPENED_BODY = 'It is open now, and stays open. Sit it whenever you are ready.';

/** A bell entry, whichever kind: a row of the student's own or a broadcast they are reached by. */
interface Entry {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  testId: string | null;
  testSeriesId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

const NEWEST_FIRST: Prisma.NotificationOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

@Injectable()
export class BellService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
  ) {}

  /** Newest first; a cursor pages after that entry, not by position. The student id is never taken from the request. */
  async list(studentId: string, query: NotificationListQuery): Promise<Paginated<Notification>> {
    const broadcasts = await this.broadcastsFor(studentId);
    const shown = broadcasts.filter(shownBy(query));
    const where: Prisma.NotificationWhereInput = { studentId, AND: narrowedBy(query) };

    // The cursor entry is excluded by position, not `skip: 1`: once read it leaves the unread filter.
    const anchor = query.cursor ? await this.anchorOf(studentId, query.cursor, broadcasts) : null;
    const skip = anchor ? 0 : (query.page - 1) * query.pageSize;
    const take = skip + query.pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: anchor ? { AND: [where, olderThan(anchor)] } : where,
        orderBy: NEWEST_FIRST,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const merged = [...rows, ...shown.filter((entry) => !anchor || isOlder(entry, anchor))]
      .sort(newestFirst)
      .slice(skip, take);
    return paged(query, merged.map(toNotification), total + shown.length);
  }

  /** Scoped by student, so somebody else's id in the path finds nothing rather than their row. */
  async markRead(studentId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findFirst({ where: { id, studentId } });
    if (row) {
      if (row.isRead) return toNotification(row);
      const updated = await this.prisma.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      });
      return toNotification(updated);
    }

    const broadcast = (await this.broadcastsFor(studentId)).find((entry) => entry.id === id);
    if (!broadcast) throw new AppException(ErrorCodes.NOT_FOUND, 'No such notification');
    if (broadcast.isRead) return toNotification(broadcast);
    const readAt = new Date();
    await this.prisma.broadcastRead.createMany({
      data: [{ studentId, broadcastId: id, readAt }],
      skipDuplicates: true,
    });
    return toNotification({ ...broadcast, isRead: true, readAt });
  }

  /** Each broadcast in the window that reaches this student and that they hold no older copy of. */
  private async broadcastsFor(studentId: string): Promise<Entry[]> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { createdAt: true },
    });
    if (!student) return [];
    // Never one sent before they joined: a broadcast reaches who there was when it went out.
    const since = new Date(
      Math.max(Date.now() - BELL_WINDOW_DAYS * MS_PER_DAY, student.createdAt.getTime()),
    );

    const [announcements, openings] = await Promise.all([
      this.announcementsReaching(studentId, since),
      this.openingsReaching(studentId, since),
    ]);
    const entries = [...announcements, ...openings];
    if (entries.length === 0) return [];

    const ids = entries.map((entry) => entry.id);
    const [reads, copies] = await Promise.all([
      this.prisma.broadcastRead.findMany({
        where: { studentId, broadcastId: { in: ids } },
        select: { broadcastId: true, readAt: true },
      }),
      // Written per student before broadcasts were resolved: the copy already stands for it.
      this.prisma.notification.findMany({
        where: {
          studentId,
          OR: [
            { announcementId: { in: ids } },
            { type: NOTIFICATION_TYPE.TEST_ASSIGNED, testId: { in: ids } },
          ],
        },
        select: { announcementId: true, testId: true },
      }),
    ]);
    const readAt = new Map(reads.map((read) => [read.broadcastId, read.readAt]));
    const copied = new Set(copies.flatMap((copy) => [copy.announcementId, copy.testId]));

    return entries
      .filter((entry) => !copied.has(entry.id))
      .map((entry) => {
        const read = readAt.get(entry.id) ?? null;
        return { ...entry, isRead: read !== null, readAt: read };
      });
  }

  private async announcementsReaching(studentId: string, since: Date): Promise<Entry[]> {
    const announcements = await this.prisma.announcement.findMany({
      // A paid send is still copied per student, because each copy is a billed message.
      where: { paidChannels: { isEmpty: true }, createdAt: { gte: since } },
      select: { id: true, title: true, body: true, audience: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: ANNOUNCEMENTS_MAX,
    });
    if (announcements.length === 0) return [];

    const matched = await this.prisma.$transaction(
      announcements.map((announcement) =>
        this.prisma.student.count({
          where: {
            AND: [
              { id: studentId },
              cohortWhere(announcement.audience as unknown as AnnouncementAudience),
            ],
          },
        }),
      ),
    );
    return announcements
      .filter((_, at) => (matched[at] ?? 0) > 0)
      .map((announcement) => ({
        id: announcement.id,
        type: NOTIFICATION_TYPE.GENERIC,
        title: announcement.title,
        body: announcement.body,
        testId: null,
        testSeriesId: null,
        isRead: false,
        readAt: null,
        createdAt: announcement.createdAt,
      }));
  }

  /** A test opened in a series their catalog holds: the audience the opening sweep pushed to. */
  private async openingsReaching(studentId: string, since: Date): Promise<Entry[]> {
    const catalog = await this.access.catalog(studentId);
    if (catalog.series.length === 0) return [];

    const tests = await this.prisma.test.findMany({
      where: {
        testSeriesId: { in: catalog.series.map((series) => series.id) },
        announcedAt: { gte: since },
      },
      select: { id: true, title: true, testSeriesId: true, announcedAt: true },
      orderBy: { announcedAt: 'desc' },
      take: OPENINGS_MAX,
    });
    return tests.map((test) => ({
      id: test.id,
      type: NOTIFICATION_TYPE.TEST_ASSIGNED,
      title: test.title ?? OPENED_TITLE,
      body: OPENED_BODY,
      testId: test.id,
      testSeriesId: test.testSeriesId,
      isRead: false,
      readAt: null,
      createdAt: test.announcedAt ?? since,
    }));
  }

  /** Where a cursor sits: a row of the student's own, or a broadcast of theirs. */
  private async anchorOf(
    studentId: string,
    cursor: string,
    broadcasts: readonly Entry[],
  ): Promise<Anchor | null> {
    const row = await this.prisma.notification.findFirst({
      where: { id: cursor, studentId },
      select: { id: true, createdAt: true },
    });
    return row ?? broadcasts.find((entry) => entry.id === cursor) ?? null;
  }
}

type Anchor = Pick<Entry, 'id' | 'createdAt'>;

const newestFirst = (a: Anchor, b: Anchor): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

const isOlder = (entry: Anchor, anchor: Anchor): boolean => newestFirst(anchor, entry) > 0;

const olderThan = (anchor: Anchor): Prisma.NotificationWhereInput => ({
  OR: [
    { createdAt: { lt: anchor.createdAt } },
    { createdAt: anchor.createdAt, id: { lt: anchor.id } },
  ],
});

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

/** The same filters, read against a broadcast held in memory. */
function shownBy(query: NotificationListQuery): (entry: Entry) => boolean {
  const range = withinInstituteDays(query.from, query.to);
  const asOf = query.unreadAsOf ? new Date(query.unreadAsOf) : null;
  const words = query.q?.toLowerCase();
  return (entry) =>
    (!query.unreadOnly ||
      !entry.isRead ||
      (asOf !== null && entry.readAt !== null && entry.readAt > asOf)) &&
    (!query.type || query.type.includes(entry.type)) &&
    (!range.gte || entry.createdAt >= range.gte) &&
    (!range.lte || entry.createdAt <= range.lte) &&
    (!words || `${entry.title} ${entry.body ?? ''}`.toLowerCase().includes(words));
}

const textHolding = (q: string) => ({ contains: q, mode: 'insensitive' }) as const;

const unreadAsOf = (asOf: string | undefined): Prisma.NotificationWhereInput =>
  asOf ? { OR: [{ isRead: false }, { readAt: { gt: new Date(asOf) } }] } : { isRead: false };

function toNotification(entry: Omit<Entry, 'readAt'> & { readAt?: Date | null }): Notification {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    body: entry.body,
    testId: entry.testId,
    testSeriesId: entry.testSeriesId,
    isRead: entry.isRead,
    createdAt: entry.createdAt.toISOString(),
  };
}
