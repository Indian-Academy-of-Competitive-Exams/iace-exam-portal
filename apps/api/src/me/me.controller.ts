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
  DOCUMENT_MAX_BYTES,
  type DeviceSession,
  type DocumentKind,
  type ErasureReceipt,
  type Me,
  type DropPushDeviceBody,
  type DropPushSubscriptionBody,
  type Notification,
  type NotificationListQuery,
  type PushConfig,
  type Paginated,
  type PushDeviceBody,
  type PushSubscriptionBody,
  type StudentCatalog,
  type StudentDataExport,
  type UpdateMeBody,
  changePinSchema,
  documentKindSchema,
  dropPushDeviceSchema,
  dropPushSubscriptionSchema,
  notificationListQuerySchema,
  pushDeviceSchema,
  pushSubscriptionSchema,
  updateMeSchema,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { AuthService, deviceFrom } from '../auth';
import { NotificationsService, PushService } from '../notifications';
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
    private readonly push: PushService,
    private readonly privacy: StudentPrivacyService,
  ) {}

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

  /** The key this browser would subscribe to push with. There is nothing else left to choose. */
  @Get('push-subscription')
  pushConfig(): PushConfig {
    return { publicKey: this.push.publicKey() };
  }

  /** This browser's push endpoint. Idempotent: the same device resubscribing is the same row. */
  @Post('push-subscription')
  @HttpCode(HttpStatus.OK)
  subscribeToPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(pushSubscriptionSchema)) body: PushSubscriptionBody,
  ): Promise<void> {
    return this.push.subscribe(user.id, body);
  }

  @Delete('push-subscription')
  @HttpCode(HttpStatus.OK)
  unsubscribeFromPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(dropPushSubscriptionSchema)) body: DropPushSubscriptionBody,
  ): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
  }

  /** This phone's FCM token. Idempotent: the same token re-registering is the same row. */
  @Post('push-device')
  @HttpCode(HttpStatus.OK)
  registerPushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(pushDeviceSchema)) body: PushDeviceBody,
  ): Promise<void> {
    return this.push.registerDevice(user.id, body);
  }

  @Delete('push-device')
  @HttpCode(HttpStatus.OK)
  dropPushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(dropPushDeviceSchema)) body: DropPushDeviceBody,
  ): Promise<void> {
    return this.push.dropDevice(user.id, body.token);
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
  @UseInterceptors(
    FileInterceptor(DOCUMENT_FILE_FIELD, { limits: { fileSize: DOCUMENT_MAX_BYTES } }),
  )
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

  /** Where this account is signed in, newest activity first, with the asking device marked. */
  @Get('sessions')
  activeDevices(@CurrentUser() user: AuthenticatedUser): Promise<DeviceSession[]> {
    return this.auth.activeDevices(user);
  }

  /** Signs another of this student's devices out. Refused for the device asking, and for one that is not theirs. */
  @Delete('sessions/:id')
  // 200, not 204: Express drops a 204's body, and the client reads the envelope.
  @HttpCode(HttpStatus.OK)
  signOutDevice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.auth.signOutDevice(user, id);
  }
}
