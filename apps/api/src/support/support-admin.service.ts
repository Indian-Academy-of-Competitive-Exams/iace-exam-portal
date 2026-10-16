import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  SUPPORT_ASSIGNEE_FILTERS,
  SUPPORT_STATUSES,
  type AdminReplyBody,
  type AdminTicketDetail,
  type AdminTicketListQuery,
  type AdminTicketPatch,
  type AdminTicketSummary,
  type LoginHelpBody,
  type Paginated,
  type SupportAttachment,
} from '@iace/contracts';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MESSAGE_SENDER,
  type MessageSender,
} from '../common/messaging';
import { everyTermMatches } from '../common/search-terms';
import { pageArgs, paged } from '../common/pagination';
import { NotificationsService, PushService } from '../notifications';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { claimChecks, type ClaimStudent } from './claim';
import {
  assertKeyUnder,
  checkSupportImage,
  supportKeyPrefix,
  type SupportUpload,
} from './support-attachments';

const NO_SUCH_TICKET = 'No such query';
const REPLY_SUBJECT = 'Your IACE query';
const REPLY_TITLE = 'IACE answered your query';

const SUMMARY_SELECT = {
  id: true,
  category: true,
  status: true,
  priority: true,
  claim: true,
  lastMessageAt: true,
  createdAt: true,
  student: { select: { fullName: true } },
  assignee: { select: { fullName: true, email: true } },
} as const satisfies Prisma.SupportTicketSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  assigneeId: true,
  contactEmail: true,
  student: {
    select: {
      id: true,
      fullName: true,
      mobile: true,
      externalRef: true,
      currentBranchId: true,
      mobileHistory: { select: { mobile: true } },
      profile: { select: { dob: true, fatherName: true } },
      enrolledExams: true,
      currentBranch: { select: { name: true } },
    },
  },
  attempt: { select: { id: true, submittedAt: true, test: { select: { title: true } } } },
  messages: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      authorType: true,
      body: true,
      attachmentKey: true,
      internal: true,
      emailFailedAt: true,
      createdAt: true,
      admin: { select: { fullName: true } },
    },
  },
} as const satisfies Prisma.SupportTicketSelect;

type SummaryRow = Prisma.SupportTicketGetPayload<{ select: typeof SUMMARY_SELECT }>;

const summaryOf = (row: SummaryRow): AdminTicketSummary => ({
  id: row.id,
  category: row.category,
  status: row.status,
  priority: row.priority,
  lastMessageAt: row.lastMessageAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  studentName: row.student?.fullName ?? null,
  claimedName: (row.claim as { fullName?: string } | null)?.fullName ?? null,
  assigneeName: row.assignee ? (row.assignee.fullName ?? row.assignee.email) : null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assigneeWhere(
  adminId: string,
  assignee: string | undefined,
): Prisma.SupportTicketWhereInput {
  if (assignee === SUPPORT_ASSIGNEE_FILTERS.MINE) return { assigneeId: adminId };
  if (assignee === SUPPORT_ASSIGNEE_FILTERS.UNCLAIMED) return { assigneeId: null };
  if (assignee === SUPPORT_ASSIGNEE_FILTERS.UNLINKED) return { studentId: null };
  if (assignee && UUID.test(assignee)) return { assigneeId: assignee };
  return {};
}

interface TicketForDelivery {
  id: string;
  studentId: string | null;
  contactEmail: string | null;
  student: { profile: { email: string | null } | null } | null;
}

@Injectable()
export class SupportAdminService {
  private readonly logger = new Logger(SupportAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    private readonly push: PushService,
  ) {}

  async list(adminId: string, query: AdminTicketListQuery): Promise<Paginated<AdminTicketSummary>> {
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.category && { category: query.category }),
      ...(query.priority && { priority: query.priority }),
      ...assigneeWhere(adminId, query.assignee),
      ...(query.q && {
        student: everyTermMatches<Prisma.StudentWhereInput>(query.q, (term) => [
          { fullName: { contains: term, mode: 'insensitive' } },
          { mobile: { contains: term } },
        ]),
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { lastMessageAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
        select: SUMMARY_SELECT,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return paged(query, rows.map(summaryOf), total);
  }

  unclaimedCount(): Promise<number> {
    return this.prisma.supportTicket.count({
      where: { assigneeId: null, status: { not: SUPPORT_STATUSES.CLOSED } },
    });
  }

  async detail(id: string): Promise<AdminTicketDetail> {
    const row = await this.prisma.supportTicket.findUnique({
      where: { id },
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
          internal: m.internal,
          emailFailedAt: m.emailFailedAt?.toISOString() ?? null,
        };
      }),
    );
    return {
      ...summaryOf(row),
      assigneeId: row.assigneeId,
      contactEmail: row.contactEmail,
      student: row.student && {
        id: row.student.id,
        fullName: row.student.fullName,
        mobile: row.student.mobile,
        branchName: row.student.currentBranch?.name ?? null,
        enrolledExams: row.student.enrolledExams,
      },
      attempt: row.attempt && {
        id: row.attempt.id,
        testName: row.attempt.test.title ?? 'Untitled test',
        submittedAt: row.attempt.submittedAt?.toISOString() ?? null,
      },
      claim: await this.claimOf(row.claim, row.student),
      messages,
    };
  }

  async reply(adminId: string, id: string, input: AdminReplyBody): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        studentId: true,
        assigneeId: true,
        contactEmail: true,
        student: { select: { profile: { select: { email: true } } } },
      },
    });
    if (!ticket) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_TICKET);
    if (ticket.status === SUPPORT_STATUSES.CLOSED) throw new AppException(ErrorCodes.TICKET_CLOSED);
    assertKeyUnder(input.attachmentKey, supportKeyPrefix(id));

    const now = new Date();
    const claim = { assigneeId: ticket.assigneeId ?? adminId };
    const oneShot = ticket.studentId === null && !input.internal;
    const ticketData: Prisma.SupportTicketUncheckedUpdateInput = input.internal
      ? claim
      : {
          ...claim,
          status: oneShot ? SUPPORT_STATUSES.CLOSED : SUPPORT_STATUSES.ANSWERED,
          answeredAt: now,
          lastMessageAt: now,
          ...(oneShot && { closedAt: now }),
        };
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorType: ActorTypes.ADMIN,
          adminId,
          body: input.body,
          attachmentKey: input.attachmentKey ?? null,
          internal: input.internal,
        },
        select: { id: true, body: true },
      });
      await tx.supportTicket.update({ where: { id }, data: ticketData });
      return created;
    });

    if (!input.internal) {
      try {
        await this.deliver(ticket, message);
      } catch (error) {
        this.logger.error(`Reply notice for ticket ${id} failed`, error);
      }
    }
    return this.detail(id);
  }

  async patch(id: string, patch: AdminTicketPatch): Promise<AdminTicketDetail> {
    if (patch.assigneeId) {
      const admin = await this.prisma.admin.findFirst({
        where: { id: patch.assigneeId, isActive: true },
        select: { id: true },
      });
      if (!admin) throw new AppException(ErrorCodes.NOT_FOUND, 'No such admin');
    }
    await this.existing(id);
    await this.prisma.supportTicket.update({
      where: { id },
      data: { priority: patch.priority, assigneeId: patch.assigneeId },
    });
    return this.detail(id);
  }

  async close(id: string): Promise<AdminTicketDetail> {
    const ticket = await this.existing(id);
    if (ticket.status !== SUPPORT_STATUSES.CLOSED) {
      await this.prisma.supportTicket.update({
        where: { id },
        data: { status: SUPPORT_STATUSES.CLOSED, closedAt: new Date() },
      });
    }
    return this.detail(id);
  }

  async resendEmail(id: string, messageId: string): Promise<AdminTicketDetail> {
    const message = await this.prisma.supportMessage.findFirst({
      where: { id: messageId, ticketId: id, internal: false, authorType: ActorTypes.ADMIN },
      select: {
        id: true,
        body: true,
        ticket: {
          select: {
            id: true,
            contactEmail: true,
            student: { select: { profile: { select: { email: true } } } },
          },
        },
      },
    });
    if (!message) throw new AppException(ErrorCodes.NOT_FOUND, 'No such message');
    const { ticket } = message;
    const sent = await this.emailReply(
      ticket.contactEmail ?? ticket.student?.profile?.email ?? null,
      ticket.id,
      message,
    );
    if (sent) {
      await this.prisma.supportMessage.update({
        where: { id: message.id },
        data: { emailFailedAt: null },
      });
    }
    return this.detail(id);
  }

  async upload(id: string, file?: SupportUpload): Promise<SupportAttachment> {
    await this.existing(id);
    const { contentType, extension, buffer } = checkSupportImage(file);
    const key = `${supportKeyPrefix(id)}${randomUUID()}.${extension}`;
    await this.storage.upload(key, buffer, contentType);
    return { key, url: await this.storage.createDownloadUrl(key) };
  }

  private async claimOf(raw: Prisma.JsonValue, student: ClaimStudent | null) {
    if (!raw) return null;
    const claim = raw as unknown as LoginHelpBody;
    const branch = await this.prisma.branch.findUnique({
      where: { id: claim.branchId },
      select: { name: true },
    });
    return claimChecks(claim, student, branch?.name ?? null);
  }

  private async existing(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!ticket) throw new AppException(ErrorCodes.NOT_FOUND, NO_SUCH_TICKET);
    return ticket;
  }

  // Push first (the bell row's sweep pushes to web and mobile); email only when nothing can be pushed to.
  private async deliver(ticket: TicketForDelivery, message: { id: string; body: string }) {
    if (!ticket.studentId) {
      await this.emailReply(ticket.contactEmail, ticket.id, message);
      return;
    }
    try {
      await this.notifications.tell(this.prisma, {
        studentId: ticket.studentId,
        type: NOTIFICATION_TYPE.SUPPORT_REPLY,
        title: REPLY_TITLE,
        data: { ticketId: ticket.id },
        dedupeKey: `support:${message.id}`,
      });
    } catch (error) {
      this.logger.error(`Bell row for ticket ${ticket.id} failed`, error);
    }
    if (await this.push.canReach(ticket.studentId)) return;
    await this.emailReply(
      ticket.contactEmail ?? ticket.student?.profile?.email ?? null,
      ticket.id,
      message,
    );
  }

  private async emailReply(
    to: string | null,
    ticketId: string,
    message: { id: string; body: string },
  ): Promise<boolean> {
    if (!to) return false;
    try {
      await this.sender.send({
        channel: MESSAGE_CHANNELS.EMAIL,
        kind: MESSAGE_KINDS.ANNOUNCEMENT,
        to,
        actor: ActorTypes.STUDENT,
        subject: REPLY_SUBJECT,
        body: `${message.body}\n\n— IACE`,
      });
      return true;
    } catch (error) {
      await this.prisma.supportMessage.update({
        where: { id: message.id },
        data: { emailFailedAt: new Date() },
      });
      this.logger.error(`Reply email for ticket ${ticketId} failed`, error);
      return false;
    }
  }
}
