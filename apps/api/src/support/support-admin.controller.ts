import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  SUPPORT_ATTACHMENT_FIELD,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  adminReplySchema,
  adminTicketListQuerySchema,
  adminTicketPatchSchema,
  type AdminReplyBody,
  type AdminTicketDetail,
  type AdminTicketListQuery,
  type AdminTicketPatch,
  type AdminTicketSummary,
  type Paginated,
  type SupportAttachment,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { type SupportUpload } from './support-attachments';
import { SupportAdminService } from './support-admin.service';

const idParam = new ZodParam(z.uuid());

/** The shared queue: any admin with the feature works any query. */
@Controller('admin/support')
@Actors(ActorTypes.ADMIN)
export class SupportAdminController {
  constructor(private readonly support: SupportAdminService) {}

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(adminTicketListQuerySchema)) query: AdminTicketListQuery,
  ): Promise<Paginated<AdminTicketSummary>> {
    return this.support.list(user.id, query);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.READ)
  @Get('unclaimed-count')
  unclaimedCount(): Promise<number> {
    return this.support.unclaimedCount();
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id', idParam) id: string): Promise<AdminTicketDetail> {
    return this.support.detail(id);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE)
  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idParam) id: string,
    @Body(new ZodBody(adminReplySchema)) body: AdminReplyBody,
  ): Promise<AdminTicketDetail> {
    return this.support.reply(user.id, id, body);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE)
  @Post(':id/attachments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(SUPPORT_ATTACHMENT_FIELD, {
      limits: { fileSize: SUPPORT_ATTACHMENT_MAX_BYTES },
    }),
  )
  upload(
    @Param('id', idParam) id: string,
    @UploadedFile() file?: SupportUpload,
  ): Promise<SupportAttachment> {
    return this.support.upload(id, file);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  patch(
    @Param('id', idParam) id: string,
    @Body(new ZodBody(adminTicketPatchSchema)) body: AdminTicketPatch,
  ): Promise<AdminTicketDetail> {
    return this.support.patch(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE)
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', idParam) id: string): Promise<AdminTicketDetail> {
    return this.support.close(id);
  }

  @RequiresFeature(FEATURE_KEYS.SUPPORT, PERMISSION_LEVELS.WRITE)
  @Post(':id/messages/:messageId/resend')
  @HttpCode(HttpStatus.OK)
  resend(
    @Param('id', idParam) id: string,
    @Param('messageId', idParam) messageId: string,
  ): Promise<AdminTicketDetail> {
    return this.support.resendEmail(id, messageId);
  }
}
