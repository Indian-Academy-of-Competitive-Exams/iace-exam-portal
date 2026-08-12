import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { type Request } from 'express';
import {
  ActorTypes,
  changePinSchema,
  updateMeSchema,
  type ChangePinBody,
  type AuthSessionResponse,
  type Me,
  type UpdateMeBody,
} from '@iace/contracts';
import { Actors, CurrentUser } from '../auth/decorators';
import { type AuthenticatedUser } from '../auth/auth.types';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import { deviceFrom } from '../auth/device';
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
