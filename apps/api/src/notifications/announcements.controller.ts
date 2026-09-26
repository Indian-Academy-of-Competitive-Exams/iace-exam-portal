import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
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
  type Paginated,
  type PaginationQuery,
} from '@iace/contracts';
import { Audit, AuditContext } from '../audit';
import { sendWorkbook } from '../common/exporting';
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
  ) {}

  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(announcementListQuerySchema)) query: PaginationQuery,
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
  @Post()
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createAnnouncementSchema)) body: CreateAnnouncementBody,
  ): Promise<Announcement> {
    return this.announcements.send(body, user.id);
  }

  @RequiresFeature(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<Announcement> {
    return this.announcements.detail(id);
  }

  @RequiresExport(FEATURE_KEYS.NOTIFICATION_MANAGEMENT)
  @Audit(AUDIT_FEATURE.ANNOUNCEMENT, AUDIT_ACTION.EXPORT)
  @Get(':id/deliveries/export')
  async deliveriesExport(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const { workbook, rows } = await this.announcements.exportDeliveries(id);
    this.auditContext.setEntityId(id);
    this.auditContext.setChanged({ rows: { from: null, to: rows } });
    sendWorkbook(response, EXPORT_KINDS.ANNOUNCEMENT_DELIVERIES, workbook);
  }
}
