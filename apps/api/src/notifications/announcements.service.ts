/**
 * What an admin says to a cohort. The audience is the STUDENT FILTER, so targeting reuses the
 * vocabulary the Students screen already speaks and the preview count is the number shown there.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { DeliveryStatus, Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementPreview,
  type AnnouncementStats,
  type AnnouncementSummary,
  type CreateAnnouncementBody,
  ANNOUNCEMENT_LIST_CHANNELS,
  type AnnouncementListChannel,
  type AnnouncementListQuery,
  type Paginated,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { withinInstituteDays } from '../common/time/institute-day';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_JOBS,
  QUEUE_NAMES,
  announceJobId,
  keyedJob,
  type AnnounceJobData,
} from '../queue/queues';
import { AppConfigService } from '../config/app-config.service';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { studentCardsOf, type StudentCard } from '../students';
import { cohortWhere, reachedBy } from './announcement-cohort';
import { SKIP_REASONS } from './notification-policy';
import { NotificationsService, type NewNotification } from './notifications.service';
import { PushService } from './push.service';

/** How many recipients one page of a delivery reads, writes or pushes. */
const CHUNK = 1000;

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /** Asked before sending and again at send, because the roster moves between the two. */
  async preview(
    audience: AnnouncementAudience,
    paidChannels: readonly AnnouncementChannel[],
  ): Promise<AnnouncementPreview> {
    const where = cohortWhere(audience);
    const cap = this.config.get('NOTIFICATION_MAX_RECIPIENTS');

    const recipientCount = await this.prisma.student.count({ where });

    return {
      recipientCount,
      estimatedCostPaise: this.priceOf(recipientCount, paidChannels),
      overCap: recipientCount > cap,
      cap,
    };
  }

  /** Records the send and queues its delivery: nothing on this request grows with the cohort. */
  async send(input: CreateAnnouncementBody, createdById: string): Promise<Announcement> {
    const cap = this.config.get('NOTIFICATION_MAX_RECIPIENTS');
    const recipientCount = await this.prisma.student.count({ where: cohortWhere(input.audience) });

    if (recipientCount > cap) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `That reaches more than the ${cap} students a single send allows`,
      );
    }
    if (recipientCount === 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That reaches nobody');
    }

    const { id } = await this.prisma.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        audience: input.audience as unknown as Prisma.InputJsonValue,
        paidChannels: [...input.paidChannels],
        recipientCount,
        estimatedCostPaise: this.priceOf(recipientCount, input.paidChannels),
        createdById,
      },
      select: { id: true },
    });
    const job: AnnounceJobData = { announcementId: id };
    await this.queue.add(NOTIFICATION_JOBS.ANNOUNCE, job, keyedJob(announceJobId(id)));

    return this.detail(id);
  }

  /** The worker's half. In-app only is pushed and never copied; a paid send needs its billed rows. */
  async deliver(announcementId: string): Promise<void> {
    const sent = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!sent) return;
    const audience = sent.audience as unknown as AnnouncementAudience;
    const paid = sent.paidChannels.length > 0;

    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.student.findMany({
        where: { AND: [reachedBy(audience, sent.createdAt), after ? { id: { gt: after } } : {}] },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: CHUNK,
      });
      if (page.length === 0) return;
      const ids = page.map((student) => student.id);
      // A replayed page lands once: the dedupe key is the send, and the push has nothing to repeat into.
      if (paid) {
        await this.notifications.tell(
          this.prisma,
          ...ids.map((studentId) => this.intentFor(studentId, sent)),
        );
      } else {
        await this.push.broadcast(ids, { broadcastId: sent.id, title: sent.title });
      }
      after = ids.at(-1);
    }
  }

  /** The one message, addressed to one student. The body rides `data` so a template can render it. */
  private intentFor(
    studentId: string,
    sent: { id: string; title: string; body: string },
  ): NewNotification {
    return {
      studentId,
      type: NOTIFICATION_TYPE.GENERIC,
      title: sent.title,
      body: sent.body,
      data: { message: sent.body },
      dedupeKey: `announcement:${sent.id}`,
      announcementId: sent.id,
    };
  }

  /** What the reachable cohort costs on every channel chosen, priced at today's configured rate. */
  private priceOf(reachable: number, channels: readonly AnnouncementChannel[]): number {
    const rate: Record<AnnouncementChannel, number> = {
      WHATSAPP: this.config.get('NOTIFICATION_COST_WHATSAPP_PAISE'),
      SMS: this.config.get('NOTIFICATION_COST_SMS_PAISE'),
    };

    // The FIRST channel is what everyone gets; the rest are only what a failure falls back to.
    const leading = channels[0];
    return leading ? reachable * (rate[leading] ?? 0) : 0;
  }

  /** Rows only. Counting the ledger per row would be six queries each; the panel asks for its own. */
  async list(query: AnnouncementListQuery): Promise<Paginated<AnnouncementSummary>> {
    const where = announcementWhere(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
        include: { createdBy: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return paged(query, rows.map(toSummary), total);
  }

  async detail(id: string): Promise<Announcement> {
    const row = await this.prisma.announcement.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, fullName: true, email: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such announcement');

    return { ...toSummary(row), stats: await this.statsOf(id) };
  }

  /** One row per notification and channel: the ledger as it stands, not as it was at the send. */
  async exportDeliveries(announcementId: string): Promise<{ workbook: Buffer; rows: number }> {
    const found = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { id: true },
    });
    if (!found) throw new AppException(ErrorCodes.NOT_FOUND, 'No such announcement');

    const where = { notification: { announcementId } };
    assertExportable(await this.prisma.notificationDelivery.count({ where }));
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where,
      select: DELIVERY_SELECT,
      orderBy: [{ notificationId: 'asc' }, { channel: 'asc' }],
    });

    const studentIds = [
      ...new Set(deliveries.flatMap(({ notification }) => notification.studentId ?? [])),
    ];
    const cards = await studentCardsOf(this.prisma, studentIds);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const rows = deliveries.map((delivery) => ({
      ...delivery,
      student: byId.get(delivery.notification.studentId ?? '') ?? null,
    }));

    const workbook = await writeWorkbook([{ name: 'Deliveries', columns: DELIVERY_COLUMNS, rows }]);
    return { workbook, rows: rows.length };
  }

  /** Counted off the ledger rather than stored: a delivery's status keeps moving after the send. */
  private async statsOf(announcementId: string): Promise<AnnouncementStats> {
    // A paid send's reads are on its rows, an in-app one's on its broadcast; the other side counts none.
    const [copiesRead, broadcastReads, groups] = await Promise.all([
      this.prisma.notification.count({ where: { announcementId, isRead: true } }),
      this.prisma.broadcastRead.count({ where: { broadcastId: announcementId } }),
      // One pass over the ledger, grouped, rather than one count per status over the same rows.
      this.prisma.notificationDelivery.groupBy({
        by: ['status', 'skipReason'],
        where: { notification: { announcementId } },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const counted = (keep: (row: (typeof groups)[number]) => boolean) =>
      groups.filter(keep).reduce((sum, row) => sum + row._count._all, 0);

    return {
      readCount: copiesRead + broadcastReads,
      sent: counted((row) => row.status === DeliveryStatus.SENT),
      // DELIVERED is never counted: it waits on a provider delivery receipt nothing sends yet.
      failed: counted((row) => row.status === DeliveryStatus.FAILED),
      skipped: counted((row) => row.status === DeliveryStatus.SKIPPED),
      savedByRead: counted((row) => row.skipReason === SKIP_REASONS.ALREADY_READ),
    };
  }
}

const DELIVERY_SELECT = {
  channel: true,
  status: true,
  skipReason: true,
  sentAt: true,
  failedAt: true,
  notification: { select: { studentId: true } },
} as const satisfies Prisma.NotificationDeliverySelect;

type DeliveryRow = Prisma.NotificationDeliveryGetPayload<{ select: typeof DELIVERY_SELECT }> & {
  student: StudentCard | null;
};

const AT = EXPORT_DATE_FORMATS.INSTANT;

const DELIVERY_COLUMNS: ExportColumn<DeliveryRow>[] = [
  { header: 'Student', width: 28, value: (row) => row.student?.fullName ?? null },
  { header: 'Mobile', width: 14, text: true, value: (row) => row.student?.mobile ?? null },
  { header: 'Channel', width: 14, value: (row) => row.channel },
  { header: 'Status', width: 12, value: (row) => row.status },
  { header: 'Skip reason', width: 16, value: (row) => row.skipReason },
  { header: 'Sent at', width: 18, date: AT, value: (row) => exportInstant(row.sentAt) },
  { header: 'Failed at', width: 18, date: AT, value: (row) => exportInstant(row.failedAt) },
];

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: unknown;
  paidChannels: string[];
  recipientCount: number;
  estimatedCostPaise: number;
  createdAt: Date;
  createdBy: { id: string; fullName: string | null; email: string };
}

function toSummary(row: AnnouncementRow): AnnouncementSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    paidChannels: row.paidChannels as AnnouncementChannel[],
    // Trusted because only `send` writes it, and it wrote a filter this schema had already parsed.
    audience: row.audience as AnnouncementAudience,
    recipientCount: row.recipientCount,
    estimatedCostPaise: row.estimatedCostPaise,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function announcementWhere(query: AnnouncementListQuery): Prisma.AnnouncementWhereInput {
  const filters: Prisma.AnnouncementWhereInput[] = [];
  if (query.channel) filters.push({ OR: query.channel.map(sentOn) });
  if (query.from || query.to)
    filters.push({ createdAt: withinInstituteDays(query.from, query.to) });
  if (query.q) {
    const text = { contains: query.q, mode: 'insensitive' } as const;
    filters.push({ OR: [{ title: text }, { body: text }] });
  }
  return { AND: filters };
}

const sentOn = (channel: AnnouncementListChannel): Prisma.AnnouncementWhereInput =>
  channel === ANNOUNCEMENT_LIST_CHANNELS.IN_APP_ONLY
    ? { paidChannels: { isEmpty: true } }
    : { paidChannels: { has: channel } };
