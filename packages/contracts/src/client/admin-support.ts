import { z } from 'zod';
import type { Paginated } from '../envelope';
import {
  ADMIN_SUPPORT_ROUTES,
  SUPPORT_ATTACHMENT_FIELD,
  adminTicketDetailSchema,
  adminTicketSummarySchema,
  supportAttachmentSchema,
  type AdminReplyInput,
  type AdminTicketDetail,
  type AdminTicketListQuery,
  type AdminTicketPatch,
  type AdminTicketSummary,
  type SupportAttachment,
} from '../support';
import type { ApiCore } from './core';

export function adminSupportClient(core: ApiCore) {
  const { get, write, list } = core;

  return {
    /** The shared queue of student queries, and answering them. */
    support: {
      list: (query: Partial<AdminTicketListQuery> = {}): Promise<Paginated<AdminTicketSummary>> =>
        list(ADMIN_SUPPORT_ROUTES.list, query, adminTicketSummarySchema),

      unclaimedCount: (): Promise<number> => get(ADMIN_SUPPORT_ROUTES.unclaimedCount, z.number()),

      detail: (id: string): Promise<AdminTicketDetail> =>
        get(ADMIN_SUPPORT_ROUTES.detail(id), adminTicketDetailSchema),

      reply: (id: string, input: AdminReplyInput): Promise<AdminTicketDetail> =>
        write('POST', ADMIN_SUPPORT_ROUTES.reply(id), adminTicketDetailSchema, input),

      patch: (id: string, input: AdminTicketPatch): Promise<AdminTicketDetail> =>
        write('PATCH', ADMIN_SUPPORT_ROUTES.patch(id), adminTicketDetailSchema, input),

      close: (id: string): Promise<AdminTicketDetail> =>
        write('POST', ADMIN_SUPPORT_ROUTES.close(id), adminTicketDetailSchema),

      resend: (id: string, messageId: string): Promise<AdminTicketDetail> =>
        write('POST', ADMIN_SUPPORT_ROUTES.resend(id, messageId), adminTicketDetailSchema),

      upload: (id: string, file: File | Blob): Promise<SupportAttachment> => {
        const form = new FormData();
        form.append(SUPPORT_ATTACHMENT_FIELD, file);
        return write('POST', ADMIN_SUPPORT_ROUTES.attachments(id), supportAttachmentSchema, form);
      },
    },
  };
}
