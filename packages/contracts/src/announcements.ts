import { z } from 'zod';
import { csvQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { dateOnlySchema, studentListQuerySchema } from './students';

/** What an admin says to a cohort. The audience is the STUDENT FILTER, not a new vocabulary. */

export const ANNOUNCEMENT_ROUTES = {
  list: '/admin/announcements',
  preview: '/admin/announcements/preview',
  create: '/admin/announcements',
  detail: (id: string) => `/admin/announcements/${id}`,
  deliveriesExport: (id: string) => `/admin/announcements/${id}/deliveries/export`,
} as const;

/** The paid channels an announcement may opt into. In-app is always sent and never charged. */
const ANNOUNCEMENT_CHANNELS = { WHATSAPP: 'WHATSAPP', SMS: 'SMS' } as const;
const announcementChannelSchema = z.enum(ANNOUNCEMENT_CHANNELS);
export type AnnouncementChannel = z.infer<typeof announcementChannelSchema>;

/** The filter, minus the parts that describe a PAGE rather than a cohort. */
export const announcementAudienceSchema = studentListQuerySchema.omit({
  page: true,
  pageSize: true,
  sort: true,
});
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

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
  estimatedCostPaise: z.number(),
  /** True when the cohort is larger than one send is allowed to be. */
  overCap: z.boolean(),
  cap: z.number(),
});
export type AnnouncementPreview = z.infer<typeof announcementPreviewSchema>;

/** What each channel did with it, counted off the delivery ledger. */
const announcementStatsSchema = z.object({
  readCount: z.number(),
  sent: z.number(),
  failed: z.number(),
  skipped: z.number(),
  /** Skipped because the student had already read it — the grace window paying for itself. */
  savedByRead: z.number(),
});
export type AnnouncementStats = z.infer<typeof announcementStatsSchema>;

/** How long a delivery ledger row is kept. Read by the pruner AND by the screen that warns about it. */
export const DELIVERY_RETENTION_DAYS = 180;

/** What the row itself carries. Counting the ledger per row would be six queries each. */
export const announcementSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  paidChannels: z.array(announcementChannelSchema),
  /** The filter as it was written, so the same notice can be sent again without rebuilding it. */
  audience: announcementAudienceSchema,
  recipientCount: z.number(),
  estimatedCostPaise: z.number(),
  createdBy: z.object({ id: z.string(), fullName: z.string().nullable(), email: z.string() }),
  createdAt: z.string(),
});
export type AnnouncementSummary = z.infer<typeof announcementSummarySchema>;

/** One announcement with its delivery counted — read when a row is opened, never per row. */
export const announcementSchema = announcementSummarySchema.extend({
  stats: announcementStatsSchema,
});
export type Announcement = z.infer<typeof announcementSchema>;

/** In-app reaches every recipient, so it is the one channel an announcement with no paid channel has. */
export const ANNOUNCEMENT_LIST_CHANNELS = {
  IN_APP_ONLY: 'IN_APP_ONLY',
  ...ANNOUNCEMENT_CHANNELS,
} as const;
const announcementListChannelSchema = z.enum(ANNOUNCEMENT_LIST_CHANNELS);
export type AnnouncementListChannel = z.infer<typeof announcementListChannelSchema>;

export const announcementListQuerySchema = paginationQuerySchema.extend({
  /** Matches the title or the body. */
  q: searchQuery(),
  channel: csvQuery(announcementListChannelSchema),
  /** Civil days in Asia/Kolkata, widened to the whole day by the service. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;
export type AnnouncementListQueryInput = z.input<typeof announcementListQuerySchema>;
