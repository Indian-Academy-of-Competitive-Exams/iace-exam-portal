import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
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

const summaryOf = (
  row: Prisma.SupportTicketGetPayload<{ select: typeof SUMMARY_SELECT }>,
): TicketSummary => ({
  id: row.id,
  category: row.category,
  status: row.status,
  lastMessageAt: row.lastMessageAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class SupportService {
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
        category: input.category,
        attemptId: input.attemptId ?? null,
        messages: { create: { authorType: ActorTypes.STUDENT, body: input.body } },
      },
      select: { id: true },
    });
    return this.detailMine(studentId, ticket.id);
  }

  async listMine(studentId: string, query: MyTicketListQuery): Promise<Paginated<TicketSummary>> {
    const where = { studentId };
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
