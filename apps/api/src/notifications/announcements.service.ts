/**
 * What an admin says to a cohort. The audience is the STUDENT FILTER, so targeting reuses the
 * vocabulary the Students screen already speaks and the preview count is the number shown there.
 */
import { Injectable } from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  STUDENT_SORTS,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementPreview,
  type AnnouncementStats,
  type CreateAnnouncementBody,
  type PaginationQuery,
  type Paginated,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { studentWhere } from '../students';
import { SKIP_REASONS, type PaidChannel } from './notification-policy';
import { NotificationOutbox, type NotificationIntent } from './notification-outbox';

/** How many recipients one fan-out writes per statement. */
const CHUNK = 500;

/** A cohort is read by id only: the rest of a student row is not what a fan-out needs. */
const RECIPIENT_SELECT = { id: true, mobile: true } as const;

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly outbox: NotificationOutbox,
  ) {}

  /** Asked before sending and again at send, because the roster moves between the two. */
  async preview(
    audience: AnnouncementAudience,
    paidChannels: readonly AnnouncementChannel[],
  ): Promise<AnnouncementPreview> {
    const where = cohortWhere(audience);
    const cap = this.config.get('NOTIFICATION_MAX_RECIPIENTS');

    const [recipientCount, reachableCount] = await this.prisma.$transaction([
      this.prisma.student.count({ where }),
      this.prisma.student.count({ where: { ...where, mobile: { not: '' } } }),
    ]);

    return {
      recipientCount,
      reachableCount,
      estimatedCostPaise: this.priceOf(reachableCount, paidChannels),
      overCap: recipientCount > cap,
      cap,
    };
  }

  /** One transaction, so a crash cannot leave half a cohort told and no record of the send. */
  async send(input: CreateAnnouncementBody, createdById: string): Promise<Announcement> {
    const priced = await this.preview(input.audience, input.paidChannels);
    if (priced.overCap) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `That reaches ${priced.recipientCount} students, over the ${priced.cap} a single send allows`,
      );
    }
    if (priced.recipientCount === 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That reaches nobody');
    }

    const recipients = await this.prisma.student.findMany({
      where: cohortWhere(input.audience),
      select: RECIPIENT_SELECT,
    });

    const id = await this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({
        data: {
          title: input.title,
          body: input.body,
          audience: input.audience as unknown as Prisma.InputJsonValue,
          paidChannels: [...input.paidChannels],
          recipientCount: recipients.length,
          estimatedCostPaise: priced.estimatedCostPaise,
          createdById,
        },
        select: { id: true },
      });

      for (const batch of chunked(recipients)) {
        await this.outbox.requestMany(
          tx,
          batch.map((student) => this.intentFor(student.id, announcement.id, input)),
        );
      }
      return announcement.id;
    });

    return this.detail(id);
  }

  /** The one message, addressed to one student. The body rides `data` so a template can render it. */
  private intentFor(
    studentId: string,
    announcementId: string,
    input: CreateAnnouncementBody,
  ): NotificationIntent {
    return {
      studentId,
      type: NOTIFICATION_TYPE.GENERIC,
      title: input.title,
      body: input.body,
      data: { message: input.body },
      dedupeKey: `announcement:${announcementId}`,
      announcementId,
      escalate: [...input.paidChannels] as PaidChannel[],
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

  async list(query: PaginationQuery): Promise<Paginated<Announcement>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { createdBy: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.announcement.count(),
    ]);

    const stats = await Promise.all(rows.map((row) => this.statsOf(row.id)));
    return {
      items: rows.map((row, at) => toAnnouncement(row, stats[at] as AnnouncementStats)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<Announcement> {
    const row = await this.prisma.announcement.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, fullName: true, email: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such announcement');

    return toAnnouncement(row, await this.statsOf(id));
  }

  /** Counted off the ledger rather than stored: a delivery's status keeps moving after the send. */
  private async statsOf(announcementId: string): Promise<AnnouncementStats> {
    const of = (status: DeliveryStatus) =>
      this.prisma.notificationDelivery.count({
        where: { notification: { announcementId }, status },
      });

    const [readCount, sent, delivered, failed, skipped, savedByRead] =
      await this.prisma.$transaction([
        this.prisma.notification.count({ where: { announcementId, isRead: true } }),
        of(DeliveryStatus.SENT),
        of(DeliveryStatus.DELIVERED),
        of(DeliveryStatus.FAILED),
        of(DeliveryStatus.SKIPPED),
        this.prisma.notificationDelivery.count({
          where: { notification: { announcementId }, skipReason: SKIP_REASONS.ALREADY_READ },
        }),
      ]);

    return { readCount, sent, delivered, failed, skipped, savedByRead };
  }
}

/** Live students only: a soft-deleted or anonymised row is not somebody to announce anything to. */
function cohortWhere(audience: AnnouncementAudience): Prisma.StudentWhereInput {
  return {
    AND: [
      studentWhere({ ...audience, page: 1, pageSize: 1, sort: STUDENT_SORTS.RECENT }),
      { deletedAt: null },
    ],
  };
}

function* chunked<T>(rows: readonly T[]): Generator<T[]> {
  for (let at = 0; at < rows.length; at += CHUNK) yield rows.slice(at, at + CHUNK);
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  paidChannels: string[];
  recipientCount: number;
  estimatedCostPaise: number;
  createdAt: Date;
  createdBy: { id: string; fullName: string | null; email: string };
}

function toAnnouncement(row: AnnouncementRow, stats: AnnouncementStats): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    paidChannels: row.paidChannels as AnnouncementChannel[],
    recipientCount: row.recipientCount,
    estimatedCostPaise: row.estimatedCostPaise,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    stats,
  };
}
