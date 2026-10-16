import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Request } from 'express';
import { z } from 'zod';
import {
  ActorTypes,
  SUPPORT_ATTACHMENT_FIELD,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  createTicketSchema,
  loginHelpSchema,
  myTicketListQuerySchema,
  ticketReplySchema,
  type BranchOption,
  type CreateTicketBody,
  type LoginHelpBody,
  type MyTicketListQuery,
  type Paginated,
  type SupportAttachment,
  type TicketDetail,
  type TicketReplyBody,
  type TicketSummary,
} from '@iace/contracts';
import { Actors, CurrentUser, Public, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { AuthRateLimit } from '../common/throttling';
import { LoginHelpService } from './login-help.service';
import { type SupportUpload } from './support-attachments';
import { SupportService } from './support.service';

const idParam = new ZodParam(z.uuid());

/** The student's own queries. The token is the subject; an id that is not theirs is not found. */
@Controller('me/support')
@Actors(ActorTypes.STUDENT)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(myTicketListQuerySchema)) query: MyTicketListQuery,
  ): Promise<Paginated<TicketSummary>> {
    return this.support.listMine(user.id, query);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idParam) id: string,
  ): Promise<TicketDetail> {
    return this.support.detailMine(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createTicketSchema)) body: CreateTicketBody,
  ): Promise<TicketDetail> {
    return this.support.create(user.id, body);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idParam) id: string,
    @Body(new ZodBody(ticketReplySchema)) body: TicketReplyBody,
  ): Promise<TicketDetail> {
    return this.support.replyAsStudent(user.id, id, body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idParam) id: string,
  ): Promise<TicketDetail> {
    return this.support.closeAsStudent(user.id, id);
  }

  @Post(':id/attachments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(SUPPORT_ATTACHMENT_FIELD, {
      limits: { fileSize: SUPPORT_ATTACHMENT_MAX_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idParam) id: string,
    @UploadedFile() file?: SupportUpload,
  ): Promise<SupportAttachment> {
    return this.support.uploadForStudent(user.id, id, file);
  }
}

/** The signed-out help form: no token, so counted per address and always answered the same. */
@Controller('auth/login-help')
export class LoginHelpController {
  constructor(private readonly loginHelp: LoginHelpService) {}

  @Public()
  @AuthRateLimit()
  @Post()
  @HttpCode(HttpStatus.OK)
  submit(
    @Body(new ZodBody(loginHelpSchema)) body: LoginHelpBody,
    @Req() request: Request,
  ): Promise<{ received: true }> {
    return this.loginHelp.submit(body, request.ip ?? 'unknown');
  }

  @Public()
  @AuthRateLimit()
  @Get('branches')
  branches(): Promise<BranchOption[]> {
    return this.loginHelp.branches();
  }
}
