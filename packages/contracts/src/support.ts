import { z } from 'zod';
import { emailSchema, mobileSchema } from './common';
import { paginationQuerySchema } from './envelope';

export const SUPPORT_CATEGORIES = {
  ACCESS: 'ACCESS',
  TEST_OR_RESULT: 'TEST_OR_RESULT',
  APP_PROBLEM: 'APP_PROBLEM',
  LOGIN_OR_ACCOUNT: 'LOGIN_OR_ACCOUNT',
  OTHER: 'OTHER',
} as const;
export const supportCategorySchema = z.enum(SUPPORT_CATEGORIES);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const SUPPORT_STATUSES = { OPEN: 'OPEN', ANSWERED: 'ANSWERED', CLOSED: 'CLOSED' } as const;
export const supportStatusSchema = z.enum(SUPPORT_STATUSES);
export type SupportStatus = z.infer<typeof supportStatusSchema>;

export const SUPPORT_PRIORITIES = { NORMAL: 'NORMAL', HIGH: 'HIGH' } as const;
export const supportPrioritySchema = z.enum(SUPPORT_PRIORITIES);
export type SupportPriority = z.infer<typeof supportPrioritySchema>;

export const SUPPORT_ATTACHMENT_FIELD = 'file';
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_BODY_MAX = 4000;
export const SUPPORT_MAX_OPEN = 3;
export const SUPPORT_AUTOCLOSE_DAYS = 4;
export const SUPPORT_FALLBACK_EMAIL = 'donotreply@iace.co.in';

export const SUPPORT_CATEGORY_INFO: Readonly<
  Record<
    SupportCategory,
    { label: string; needsSitting: boolean; signedOut: boolean; cannedAnswer: string }
  >
> = {
  [SUPPORT_CATEGORIES.ACCESS]: {
    label: 'Access',
    needsSitting: false,
    signedOut: false,
    cannedAnswer:
      'Tests open to you are under Tests. A test your branch has not given you will not show.',
  },
  [SUPPORT_CATEGORIES.TEST_OR_RESULT]: {
    label: 'Test or result',
    needsSitting: true,
    signedOut: false,
    cannedAnswer: 'Results appear once scoring finishes, usually within minutes of submitting.',
  },
  [SUPPORT_CATEGORIES.APP_PROBLEM]: {
    label: 'App problem',
    needsSitting: false,
    signedOut: false,
    cannedAnswer: 'Update the app and try again; most problems are fixed in the latest version.',
  },
  [SUPPORT_CATEGORIES.LOGIN_OR_ACCOUNT]: {
    label: 'Login or account',
    needsSitting: false,
    signedOut: true,
    cannedAnswer:
      'You sign in with a code sent to your registered mobile. Only IACE can change that number.',
  },
  [SUPPORT_CATEGORIES.OTHER]: {
    label: 'Other',
    needsSitting: false,
    signedOut: false,
    cannedAnswer: 'Tell us what you need in one or two lines.',
  },
};

const body = z.string().trim().min(1, 'Write a message').max(SUPPORT_BODY_MAX);
const attachmentKey = z.string().min(1).optional();

/** Text only: an image attaches to a later message, once the ticket exists to hold it. */
export const createTicketSchema = z
  .object({
    category: z.enum(SUPPORT_CATEGORIES, { error: 'Choose a category' }),
    attemptId: z.uuid().optional(),
    body,
  })
  .refine((v) => !SUPPORT_CATEGORY_INFO[v.category].needsSitting || Boolean(v.attemptId), {
    path: ['attemptId'],
    message: 'Choose the test this is about',
  });
export type CreateTicketBody = z.infer<typeof createTicketSchema>;
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const ticketReplySchema = z.object({ body, attachmentKey });
export type TicketReplyBody = z.infer<typeof ticketReplySchema>;

export const adminReplySchema = z.object({
  body,
  attachmentKey,
  internal: z.boolean().default(false),
});
export type AdminReplyBody = z.infer<typeof adminReplySchema>;
export type AdminReplyInput = z.input<typeof adminReplySchema>;

export const adminTicketPatchSchema = z
  .object({
    priority: supportPrioritySchema.optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.priority !== undefined || v.assigneeId !== undefined);
export type AdminTicketPatch = z.infer<typeof adminTicketPatchSchema>;

export const SUPPORT_ASSIGNEE_FILTERS = {
  MINE: 'mine',
  UNCLAIMED: 'unclaimed',
  UNLINKED: 'unlinked',
} as const;

export const adminTicketListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().optional(),
  status: supportStatusSchema.optional(),
  category: supportCategorySchema.optional(),
  priority: supportPrioritySchema.optional(),
  assignee: z.string().optional(),
});
export type AdminTicketListQuery = z.infer<typeof adminTicketListQuerySchema>;

export const myTicketListQuerySchema = paginationQuerySchema;
export type MyTicketListQuery = z.infer<typeof myTicketListQuerySchema>;

export const LOGIN_PROBLEMS = {
  OTP_NOT_ARRIVING: 'OTP_NOT_ARRIVING',
  NUMBER_CHANGED: 'NUMBER_CHANGED',
  OTHER: 'OTHER',
} as const;

export const loginHelpSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  registeredMobile: mobileSchema,
  dob: z.iso.date({ error: 'Enter your date of birth' }),
  fatherName: z.string().trim().min(2, "Enter your father's name").max(120),
  branchId: z.uuid({ error: 'Choose your branch' }),
  enrolmentId: z.string().trim().max(60).optional(),
  contactMobile: mobileSchema.optional(),
  contactEmail: emailSchema,
  problem: z.enum(LOGIN_PROBLEMS, { error: 'Choose what is wrong' }),
  body,
});
export type LoginHelpBody = z.infer<typeof loginHelpSchema>;
export type LoginHelpInput = z.input<typeof loginHelpSchema>;

export const supportAttachmentSchema = z.object({ key: z.string(), url: z.string() });
export type SupportAttachment = z.infer<typeof supportAttachmentSchema>;

export const supportMessageSchema = z.object({
  id: z.string(),
  fromStaff: z.boolean(),
  authorName: z.string().nullable(),
  body: z.string(),
  attachmentUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

export const ticketSummarySchema = z.object({
  id: z.string(),
  category: supportCategorySchema,
  status: supportStatusSchema,
  lastMessageAt: z.string(),
  createdAt: z.string(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  attemptId: z.string().nullable(),
  messages: z.array(supportMessageSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const adminSupportMessageSchema = supportMessageSchema.extend({
  internal: z.boolean(),
  emailFailedAt: z.string().nullable(),
});

const claimCheck = z.object({ claimed: z.string().nullable(), matches: z.boolean().nullable() });

export const adminTicketSummarySchema = ticketSummarySchema.extend({
  priority: supportPrioritySchema,
  /** Tied to a student record; false is the signed-out ticket nobody matched. */
  linked: z.boolean(),
  studentName: z.string().nullable(),
  claimedName: z.string().nullable(),
  assigneeName: z.string().nullable(),
});
export type AdminTicketSummary = z.infer<typeof adminTicketSummarySchema>;

export const adminTicketDetailSchema = adminTicketSummarySchema.extend({
  assigneeId: z.string().nullable(),
  contactEmail: z.string().nullable(),
  student: z
    .object({
      id: z.string(),
      fullName: z.string().nullable(),
      mobile: z.string(),
      branchName: z.string().nullable(),
      enrolledExams: z.array(z.string()),
    })
    .nullable(),
  attempt: z
    .object({ id: z.string(), testName: z.string(), submittedAt: z.string().nullable() })
    .nullable(),
  /** Each claimed field beside whether it agrees with the linked student's record (null: nothing to compare). */
  claim: z.record(z.string(), claimCheck).nullable(),
  messages: z.array(adminSupportMessageSchema),
});
export type AdminTicketDetail = z.infer<typeof adminTicketDetailSchema>;

export const branchOptionSchema = z.object({ id: z.string(), name: z.string() });
export type BranchOption = z.infer<typeof branchOptionSchema>;

export const SUPPORT_ROUTES = {
  list: '/me/support',
  create: '/me/support',
  detail: (id: string) => `/me/support/${id}`,
  reply: (id: string) => `/me/support/${id}/messages`,
  close: (id: string) => `/me/support/${id}/close`,
  attachments: (id: string) => `/me/support/${id}/attachments`,
} as const;

export const ADMIN_SUPPORT_ROUTES = {
  list: '/admin/support',
  unclaimedCount: '/admin/support/unclaimed-count',
  detail: (id: string) => `/admin/support/${id}`,
  patch: (id: string) => `/admin/support/${id}`,
  reply: (id: string) => `/admin/support/${id}/messages`,
  attachments: (id: string) => `/admin/support/${id}/attachments`,
  close: (id: string) => `/admin/support/${id}/close`,
  resend: (id: string, messageId: string) => `/admin/support/${id}/messages/${messageId}/resend`,
} as const;

export const LOGIN_HELP_ROUTES = {
  submit: '/auth/login-help',
  branches: '/auth/login-help/branches',
} as const;
