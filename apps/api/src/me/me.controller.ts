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
import { AuthService, deviceFrom } from '../auth';
import { MeService } from './me.service';

/**
 * The signed-in student's own account.
 *
 * No ids in any route. The subject is always `user.id` from the token, which is
 * what makes it impossible to shape a request that reaches another student's
 * record — there is no parameter to tamper with.
 *
 * No `@RequiresPage`: page permissions are an ADMIN concept. `@Actors(STUDENT)`
 * is the whole authorisation rule here, and it is the one that matters — an
 * admin token must not be able to call these either.
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

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(updateMeSchema)) body: UpdateMeBody,
  ): Promise<Me> {
    return this.me.update(user.id, body);
  }

  /**
   * A photo or an identity document.
   *
   * The KIND is in the path and validated against a fixed list, so a request
   * cannot name the column it writes to. The file is checked for type and size
   * before it reaches storage — see documents.ts.
   */
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
   * AuthService.changeStudentPin. The client must store the returned tokens:
   * the ones it is holding stopped working the moment this succeeded.
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
