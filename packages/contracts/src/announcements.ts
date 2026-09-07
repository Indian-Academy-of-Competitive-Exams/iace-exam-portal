import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { studentListQuerySchema } from './students';

/** What an admin says to a cohort. The audience is the STUDENT FILTER, not a new vocabulary. */

export const ANNOUNCEMENT_ROUTES = {
  list: '/admin/announcements',
  preview: '/admin/announcements/preview',
  create: '/admin/announcements',
  detail: (id: string) => `/admin/announcements/${id}`,
} as const;

/** The paid channels an announcement may opt into. In-app is always sent and never charged. */
export const ANNOUNCEMENT_CHANNELS = { WHATSAPP: 'WHATSAPP', SMS: 'SMS' } as const;
export const announcementChannelSchema = z.enum(ANNOUNCEMENT_CHANNELS);
export type AnnouncementChannel = z.infer<typeof announcementChannelSchema>;

/** The filter, minus the parts that describe a PAGE rather than a cohort. */
export const announcementAudienceSchema = studentListQuerySchema.omit({
  page: true,
  pageSize: true,
  sort: true,
});
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;
export type AnnouncementAudienceInput = z.input<typeof announcementAudienceSchema>;

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(ANNOUNCEMENT_TITLE_MAX),
  body: z.string().trim().min(1, 'Required').max(ANNOUNCEMENT_BODY_MAX),
  audience: announcementAudienceSchema,
  /** Empty is in-app only. Anything here is money, which is why the preview is confirmed first. */
  paidChannels: z.array(announcementChannelSchema).default([]),
});
export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;
export type CreateAnnouncementBody = z.infer<typeof createAnnouncementSchema>;

/** Asked before sending, and again on the server at send: the roster moves between the two. */
export const announcementPreviewSchema = z.object({
  recipientCount: z.number(),
  /** How many of them a paid channel could actually reach — the rest have no mobile on file. */
  reachableCount: z.number(),
  estimatedCostPaise: z.number(),
  /** True when the cohort is larger than one send is allowed to be. */
  overCap: z.boolean(),
  cap: z.number(),
});
export type AnnouncementPreview = z.infer<typeof announcementPreviewSchema>;

/** What each channel did with it, counted off the delivery ledger. */
export const announcementStatsSchema = z.object({
  readCount: z.number(),
  sent: z.number(),
  delivered: z.number(),
  failed: z.number(),
  skipped: z.number(),
  /** Skipped because the student had already read it — the grace window paying for itself. */
  savedByRead: z.number(),
});
export type AnnouncementStats = z.infer<typeof announcementStatsSchema>;

export const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  paidChannels: z.array(announcementChannelSchema),
  recipientCount: z.number(),
  estimatedCostPaise: z.number(),
  createdBy: z.object({ id: z.string(), fullName: z.string().nullable(), email: z.string() }),
  createdAt: z.string(),
  stats: announcementStatsSchema,
});
export type Announcement = z.infer<typeof announcementSchema>;

export const announcementListQuerySchema = paginationQuerySchema;
export type AnnouncementListQueryInput = z.input<typeof announcementListQuerySchema>;
