import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  SUPPORT_AUTOCLOSE_DAYS,
  SUPPORT_MAX_OPEN,
  SUPPORT_STATUSES,
  type CreateTicketBody,
  type MyTicketListQuery,
  type Paginated,
  type SupportAttachment,
  type TicketDetail,
  type TicketReplyBody,
  type TicketSummary,
} from '@iace/contracts';
import { MS_PER_DAY } from '../common/time/units';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  assertKeyUnder,
  checkSupportImage,
  supportKeyPrefix,
  type SupportUpload,
} from './support-attachments';

const SUMMARY_SELECT = {
  id: true,
  title: true,
  category: true,
  status: true,
  lastMessageAt: true,
  createdAt: true,
} as const satisfies Prisma.SupportTicketSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  attemptId: true,
  messages: {
    where: { internal: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      authorType: true,
      body: true,
      attachmentKey: true,
      createdAt: true,
      admin: { select: { fullName: true } },
    },
  },
} as const satisfies Prisma.SupportTicketSelect;

const NO_SUCH_TICKET = 'No such query';
const ACK_BODY = 'Thanks for contacting us. We will review your query at the earliest.';

/** The student's words, then IACE's acknowledgement a millisecond later so the order never ties. */
export function openingMessages(body: string, at = new Date()) {
  return [
    { authorType: ActorTypes.STUDENT, body, createdAt: at },
    { authorType: ActorTypes.ADMIN, body: ACK_BODY, createdAt: new Date(at.getTime() + 1) },
  ];
}

const summaryOf = (
  row: Prisma.SupportTicketGetPayload<{ select: typeof SUMMARY_SELECT }>,
): TicketSummary => ({
  id: row.id,
  title: row.title,
  category: row.category,
  status: row.status,
  lastMessageAt: row.lastMessageAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(studentId: string, input: CreateTicketBody): Promise<TicketDetail> {
    if (input.attemptId) {
      const sitting = await this.prisma.attempt.findFirst({
        where: { id: input.attemptId, studentId },
        select: { id: true },
      });
      if (!sitting) throw new AppException(ErrorCodes.NOT_FOUND, 'No such sitting');
    }
    const open = await this.prisma.supportTicket.count({
      where: { studentId, status: { not: SUPPORT_STATUSES.CLOSED } },
    });
    // ponytail: count-then-insert, a double-click can reach 4; a lock if that ever matters.
    if (open >= SUPPORT_MAX_OPEN) throw new AppException(ErrorCodes.TICKET_LIMIT);
    const ticket = await this.prisma.supportTicket.create({
      data: {
        studentId,
        title: input.title ?? null,
        category: input.category,
        attemptId: input.attemptId ?? null,
        messages: { create: openingMessages(input.body) },
      },
      select: { id: true },
    });
    return this.detailMine(studentId, ticket.id);
  }

  async listMine(studentId: string, query: MyTicketListQuery): Promise<Paginated<TicketSummary>> {
    const where: Prisma.SupportTicketWhereInput = {
      studentId,
      ...(query.status && { status: query.status }),
      ...(query.category && { category: query.category }),
      ...(query.q && {
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          {
            messages: {
              some: { internal: false, body: { contains: query.q, mode: 'insensitive' } },
            },
          },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
        select: SUMMARY_SELECT,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return paged(query, rows.map(summaryOf), total);
  }

  async detailMine(studentId: string, id: string): Promise<TicketDetail> {
    const row = await this.prisma.supportTicket.findFirst({
      where: { id, studentId },
      select: DETAIL_SELECT,
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_TICKET);
    await this.prisma.supportTicket.updateMany({
      where: { id, studentReadAt: null },
      data: { studentReadAt: new Date() },
    });
    const messages = await Promise.all(
      row.messages.map(async (m) => {
        const fromStaff = m.authorType === ActorTypes.ADMIN;
        return {
          id: m.id,
          fromStaff,
          authorName: fromStaff ? (m.admin?.fullName ?? null) : null,
          body: m.body,
          attachmentUrl: m.attachmentKey
            ? await this.storage.createDownloadUrl(m.attachmentKey)
            : null,
          createdAt: m.createdAt.toISOString(),
        };
      }),
    );
    return { ...summaryOf(row), attemptId: row.attemptId, messages };
  }

  async replyAsStudent(
    studentId: string,
    id: string,
    input: TicketReplyBody,
  ): Promise<TicketDetail> {
    await this.ownOpenTicket(studentId, id);
    assertKeyUnder(input.attachmentKey, supportKeyPrefix(id));
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: id,
          authorType: ActorTypes.STUDENT,
          body: input.body,
          attachmentKey: input.attachmentKey ?? null,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: { status: SUPPORT_STATUSES.OPEN, answeredAt: null, lastMessageAt: now },
      }),
    ]);
    return this.detailMine(studentId, id);
  }

  async closeAsStudent(studentId: string, id: string): Promise<TicketDetail> {
    const ticket = await this.ownTicket(studentId, id);
    if (ticket.status !== SUPPORT_STATUSES.CLOSED) {
      await this.prisma.supportTicket.update({
        where: { id },
        data: { status: SUPPORT_STATUSES.CLOSED, closedAt: new Date() },
      });
    }
    return this.detailMine(studentId, id);
  }

  async closeStale(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SUPPORT_AUTOCLOSE_DAYS * MS_PER_DAY);
    const { count } = await this.prisma.supportTicket.updateMany({
      where: { status: SUPPORT_STATUSES.ANSWERED, answeredAt: { lt: cutoff } },
      data: { status: SUPPORT_STATUSES.CLOSED, closedAt: now },
    });
    return count;
  }

  async uploadForStudent(
    studentId: string,
    id: string,
    file?: SupportUpload,
  ): Promise<SupportAttachment> {
    await this.ownOpenTicket(studentId, id);
    const { contentType, extension, buffer } = checkSupportImage(file);
    const key = `${supportKeyPrefix(id)}${randomUUID()}.${extension}`;
    await this.storage.upload(key, buffer, contentType);
    return { key, url: await this.storage.createDownloadUrl(key) };
  }

  /** Inside the erasure transaction: deletes the student's tickets (messages cascade) and returns their picture keys. */
  async eraseFor(studentId: string, tx: Prisma.TransactionClient): Promise<string[]> {
    const messages = await tx.supportMessage.findMany({
      where: { ticket: { studentId }, attachmentKey: { not: null } },
      select: { attachmentKey: true },
    });
    await tx.supportTicket.deleteMany({ where: { studentId } });
    return messages.flatMap((m) => (m.attachmentKey ? [m.attachmentKey] : []));
  }

  /** After the commit, so a failed delete leaves an orphan object rather than a row pointing at nothing. */
  async removeAttachments(keys: string[]): Promise<void> {
    const results = await Promise.allSettled(keys.map((key) => this.storage.remove(key)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(`Support attachment ${keys[i]} was not removed`, result.reason);
      }
    });
  }

  private async ownTicket(studentId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, studentId },
      select: { status: true },
    });
    if (!ticket) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_TICKET);
    return ticket;
  }

  private async ownOpenTicket(studentId: string, id: string): Promise<void> {
    const ticket = await this.ownTicket(studentId, id);
    if (ticket.status === SUPPORT_STATUSES.CLOSED) throw new AppException(ErrorCodes.TICKET_CLOSED);
  }
}
