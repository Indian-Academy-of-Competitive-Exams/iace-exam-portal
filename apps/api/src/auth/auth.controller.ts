import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { type Request } from 'express';
import {
  refreshTokenSchema,
  requestAdminOtpSchema,
  requestStudentOtpSchema,
  verifyAdminOtpSchema,
  verifyStudentOtpSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type OtpRequestResponse,
  type RefreshTokenBody,
  type RequestAdminOtpBody,
  type RequestStudentOtpBody,
  type VerifyAdminOtpBody,
  type VerifyStudentOtpBody,
} from '@iace/contracts';
import { AuthService } from './auth.service';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/security';
import { AuthRateLimit, OtpRequestRateLimit } from '../common/throttling';
import { deviceFrom } from './device';
import { ZodBody } from '../common/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ---- Students: mobile + OTP, every sign-in; the first one is the signup ------

  /** Step 1 — the one route that pays for a send. */
  @Public()
  @OtpRequestRateLimit()
  @Post('student/otp/request')
  @HttpCode(HttpStatus.OK)
  requestStudentOtp(
    @Body(new ZodBody(requestStudentOtpSchema)) body: RequestStudentOtpBody,
    @Req() request: Request,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestStudentOtp(body.mobile, request.ip ?? 'unknown');
  }

  /** Step 2 — signs them in, as a new account if the number had none. */
  @Public()
  @AuthRateLimit()
  @Post('student/otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyStudentOtp(
    @Body(new ZodBody(verifyStudentOtpSchema)) body: VerifyStudentOtpBody,
    @Req() request: Request,
  ): Promise<AuthSessionResponse> {
    return this.auth.verifyStudentOtp(body.mobile, body.code, deviceFrom(request, body.device));
  }

  // ---- Admins: email + OTP ---------------------------------------------------

  @Public()
  @AuthRateLimit()
  @Post('admin/otp/request')
  @HttpCode(HttpStatus.OK)
  requestAdminOtp(
    @Body(new ZodBody(requestAdminOtpSchema)) body: RequestAdminOtpBody,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestAdminOtp(body.email);
  }

  @Public()
  @AuthRateLimit()
  @Post('admin/otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyAdminOtp(
    @Body(new ZodBody(verifyAdminOtpSchema)) body: VerifyAdminOtpBody,
    @Req() request: Request,
  ): Promise<AuthSessionResponse> {
    return this.auth.verifyAdminOtp(body.email, body.code, deviceFrom(request, body.device));
  }

  // ---- Session ---------------------------------------------------------------

  @Public()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodBody(refreshTokenSchema)) body: RefreshTokenBody): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  /** Returns no payload: the envelope's `success` is the entire answer. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthIdentity> {
    return this.auth.me(user);
  }
}
