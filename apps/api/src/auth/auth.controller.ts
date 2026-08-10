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
  type LogoutResponse,
  type OtpRequestResponse,
  type RefreshTokenBody,
  type RequestAdminOtpBody,
  type RequestStudentOtpBody,
  type VerifyAdminOtpBody,
  type VerifyStudentOtpBody,
} from '@iace/contracts';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { type AuthenticatedUser, type DeviceContext } from './auth.types';
import { ZodBody } from '../common/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ---- Students: mobile + OTP ------------------------------------------------

  @Public()
  @Post('student/otp/request')
  @HttpCode(HttpStatus.OK)
  requestStudentOtp(
    @Body(new ZodBody(requestStudentOtpSchema)) body: RequestStudentOtpBody,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestStudentOtp(body.mobile);
  }

  @Public()
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
  @Post('admin/otp/request')
  @HttpCode(HttpStatus.OK)
  requestAdminOtp(
    @Body(new ZodBody(requestAdminOtpSchema)) body: RequestAdminOtpBody,
  ): Promise<OtpRequestResponse> {
    return this.auth.requestAdminOtp(body.email);
  }

  @Public()
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodBody(refreshTokenSchema)) body: RefreshTokenBody,
    @Req() request: Request,
  ): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken, deviceFrom(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<LogoutResponse> {
    await this.auth.logout(user);
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthIdentity> {
    return this.auth.me(user);
  }
}

/** Device binding context: what the client claims, plus what we can observe. */
function deviceFrom(
  request: Request,
  claimed?: { deviceId?: string; deviceName?: string },
): DeviceContext {
  return {
    deviceId: claimed?.deviceId ?? null,
    deviceName: claimed?.deviceName ?? null,
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
