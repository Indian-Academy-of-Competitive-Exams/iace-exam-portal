import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
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
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AnnouncementsService } from './announcements.service';

/** Sending one costs money, so WRITE on its own feature key rather than riding a student's. */
@Controller('admin/announcements')
@Actors(ActorTypes.ADMIN)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

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
}
