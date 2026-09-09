import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Delete,
  Param,
  Patch,
  Post,
  Put,
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
  type ConsentState,
  type ConsentStatus,
  DOCUMENT_FILE_FIELD,
  type DocumentKind,
  type ErasureReceipt,
  type Me,
  type DropPushSubscriptionBody,
  type Notification,
  type NotificationListQuery,
  type NotificationPreferences,
  type Paginated,
  type PushSubscriptionBody,
  type SetNotificationPreferenceBody,
  type RecordConsentBody,
  type StudentCatalog,
  type StudentDataExport,
  type UpdateMeBody,
  changePinSchema,
  documentKindSchema,
  dropPushSubscriptionSchema,
  notificationListQuerySchema,
  pushSubscriptionSchema,
  recordConsentSchema,
  setNotificationPreferenceSchema,
  updateMeSchema,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { AuthService, deviceFrom } from '../auth';
import {
  NotificationPreferencesService,
  NotificationsService,
  PushService,
} from '../notifications';
import { MeService } from './me.service';
import { StudentPrivacyService } from '../students';

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
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly push: PushService,
    private readonly privacy: StudentPrivacyService,
  ) {}

  /** What they have agreed to, beside what the notice says today — the SPA compares the two. */
  @Get('consent')
  consent(@CurrentUser() user: AuthenticatedUser): Promise<ConsentStatus> {
    return this.privacy.status(user.id);
  }

  /** Answering the notice again. Append-only: this never edits what was agreed to before. */
  @Post('consent')
  @HttpCode(HttpStatus.OK)
  recordConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(recordConsentSchema)) body: RecordConsentBody,
  ): Promise<ConsentState> {
    return this.privacy.record(user.id, body);
  }

  /** Everything held about them, in one read. */
  @Get('data-export')
  @Header('Cache-Control', 'no-store')
  dataExport(@CurrentUser() user: AuthenticatedUser): Promise<StudentDataExport> {
    return this.privacy.export(user.id);
  }

  /** Irreversible, and not a delete: the sittings stay, and nothing in them names anybody. */
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.DELETE)
  @Post('erasure')
  @HttpCode(HttpStatus.OK)
  erase(@CurrentUser() user: AuthenticatedUser): Promise<ErasureReceipt> {
    return this.privacy.anonymize(user.id);
  }

  @Get()
  profile(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.me.profile(user.id);
  }

  /** Every series this student reaches, with today's window applied. */
  @Get('catalog')
  catalog(@CurrentUser() user: AuthenticatedUser): Promise<StudentCatalog> {
    return this.me.catalog(user.id);
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

  /** Every channel and whether it is on, with the key this browser would subscribe to push with. */
  @Get('notification-preferences')
  notificationPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferences> {
    return this.preferences.read(user.id);
  }

  /** One channel at a time, answering with the whole set — the screen never patches its own copy. */
  @Put('notification-preferences')
  setNotificationPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(setNotificationPreferenceSchema)) body: SetNotificationPreferenceBody,
  ): Promise<NotificationPreferences> {
    return this.preferences.set(user.id, body);
  }

  /** This browser's push endpoint. Idempotent: the same device resubscribing is the same row. */
  @Post('push-subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribeToPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(pushSubscriptionSchema)) body: PushSubscriptionBody,
  ): Promise<void> {
    return this.push.subscribe(user.id, body);
  }

  @Delete('push-subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribeFromPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(dropPushSubscriptionSchema)) body: DropPushSubscriptionBody,
  ): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
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
