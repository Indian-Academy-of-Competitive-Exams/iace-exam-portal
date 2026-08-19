import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Request } from 'express';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  DOCUMENT_FILE_FIELD,
  changePinSchema,
  documentKindSchema,
  updateMeSchema,
  type DocumentKind,
  type ChangePinBody,
  type AuthSessionResponse,
  type Me,
  type UpdateMeBody,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodParam } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { AuthService, deviceFrom } from '../auth';
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
  ) {}

  @Get()
  profile(@CurrentUser() user: AuthenticatedUser): Promise<Me> {
    return this.me.profile(user.id);
  }

  @Audit(AUDIT_FEATURE.STUDENT_PROFILE, AUDIT_ACTION.UPDATE)
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(updateMeSchema)) body: UpdateMeBody,
  ): Promise<Me> {
    return this.me.update(user.id, body);
  }

  /** A photo or an identity document. */
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
