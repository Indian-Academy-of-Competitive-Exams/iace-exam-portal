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
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Request } from 'express';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  type AuthSessionResponse,
  type ChangePinBody,
  DOCUMENT_FILE_FIELD,
  type DocumentKind,
  type Me,
  type Notification,
  type NotificationListQuery,
  type OpenSeriesList,
  type Paginated,
  type SeriesUnlockRequest,
  type StudentCatalog,
  type UpdateMeBody,
  changePinSchema,
  documentKindSchema,
  notificationListQuerySchema,
  updateMeSchema,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { AuthService, deviceFrom } from '../auth';
import { AccessResolverService, UnlocksService } from '../access';
import { NotificationsService } from '../notifications';
import { MeService } from './me.service';

/**
 * The signed-in student's own account. No ids in any route — the subject is always
 * `user.id` from the token, so no request shape can reach another student's record.
 */
/** The two fields we use off a multipart upload — see imports.controller.ts. */
interface UploadedFileLike {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

@Controller('me')
@Actors(ActorTypes.STUDENT)
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly auth: AuthService,
    private readonly access: AccessResolverService,
    private readonly unlocks: UnlocksService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  profile(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.me.profile(user.id);
  }

  /** Every series this student reaches, with today's window applied. */
  @Get('catalog')
  catalog(@CurrentUser() user: AuthenticatedUser): Promise<StudentCatalog> {
    return this.access.catalog(user.id);
  }

  /** The FREE series they do not reach yet. Writes nothing — this is the browse list. */
  @Get('series/open')
  openSeries(@CurrentUser() user: AuthenticatedUser): Promise<OpenSeriesList> {
    return this.unlocks.openToAsk(user.id);
  }

  /** Asking for a locked series they reach, or a FREE one they do not — see the service. */
  @Post('series/:testSeriesId/unlock-request')
  requestUnlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('testSeriesId') testSeriesId: string,
  ): Promise<SeriesUnlockRequest> {
    return this.unlocks.request(user.id, testSeriesId);
  }

  @Get('notifications')
  notificationList(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<Paginated<Notification>> {
    return this.notifications.list(user.id, query);
  }

  @Patch('notifications/:id/read')
  markNotificationRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(user.id, id);
  }

  @Audit(AUDIT_FEATURE.STUDENT_PROFILE, AUDIT_ACTION.UPDATE)
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(updateMeSchema)) body: UpdateMeBody,
  ): Promise<Me> {
    return this.me.update(user.id, body);
  }

  /** The student's photo. */
  @Audit(AUDIT_FEATURE.STUDENT_PROFILE, AUDIT_ACTION.UPDATE)
  @Post('documents/:kind')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(DOCUMENT_FILE_FIELD))
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind', new ZodParam(documentKindSchema)) kind: DocumentKind,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<Me> {
    return this.me.saveDocument(user.id, kind, file);
  }

  /**
   * Ends every OTHER session and returns a fresh one for this device — see
   * AuthService.changeStudentPin.
   */
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  changePin(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(changePinSchema)) body: ChangePinBody,
    @Req() request: Request,
  ): Promise<AuthSessionResponse> {
    return this.auth.changeStudentPin(user.id, body.currentPin, body.newPin, deviceFrom(request));
  }
}
