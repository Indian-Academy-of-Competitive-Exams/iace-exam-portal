import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  EXPORT_KINDS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  announcementListQuerySchema,
  createAnnouncementSchema,
  type Announcement,
  type AnnouncementPreview,
  type AnnouncementSummary,
  type CreateAnnouncementBody,
  type ExportStarted,
  type Paginated,
  type AnnouncementListQuery,
} from '@iace/contracts';
import { Audit, AuditContext } from '../audit';
import { ExportJobsService } from '../common/exporting';
import {
  Actors,
  CurrentUser,
  RequiresExport,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AnnouncementsService } from './announcements.service';

/** Sending one costs money, so WRITE on its own feature key rather than riding a student's. */
@Controller('admin/announcements')
@Actors(ActorTypes.ADMIN)
export class AnnouncementsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly auditContext: AuditContext,
    private readonly exportJobs: ExportJobsService,
  ) {}

  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(announcementListQuerySchema)) query: AnnouncementListQuery,
  ): Promise<Paginated<AnnouncementSummary>> {
    return this.announcements.list(query);
  }

  /** A POST because it reads a cohort off the body, and it changes nothing. */
  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(new ZodBody(createAnnouncementSchema)) body: CreateAnnouncementBody,
  ): Promise<AnnouncementPreview> {
    return this.announcements.preview(body.audience, body.paidChannels);
  }

  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Audit(AUDIT_FEATURE.ANNOUNCEMENT, AUDIT_ACTION.CREATE)
  @Post()
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createAnnouncementSchema)) body: CreateAnnouncementBody,
  ): Promise<Announcement> {
    const sent = await this.announcements.send(body, user.id);
    this.auditContext.setChanged({
      recipients: { from: null, to: sent.recipientCount },
      paidChannels: { from: null, to: sent.paidChannels },
    });
    return sent;
  }

  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<Announcement> {
    return this.announcements.detail(id);
  }

  @RequiresExport(FEATURE_KEYS.NOTIFICATION_MANAGEMENT)
  @Post(':id/deliveries/export')
  @HttpCode(HttpStatus.ACCEPTED)
  deliveriesExport(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExportStarted> {
    const request = { kind: EXPORT_KINDS.ANNOUNCEMENT_DELIVERIES, announcementId: id } as const;
    return this.exportJobs.start(request, user);
  }
}
