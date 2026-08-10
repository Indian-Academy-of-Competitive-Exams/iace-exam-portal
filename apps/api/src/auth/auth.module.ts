import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { OtpService } from './otp/otp.service';
import { ConsoleOtpSender } from './otp/console-otp-sender';
import { OTP_SENDER, type OtpSender } from './otp/otp-sender';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ActorGuard } from './guards/actor.guard';
import { PagePermissionGuard } from './guards/page-permission.guard';

/**
 * Selects the OTP delivery channel. The console sender is a development
 * convenience and is refused outright in production, so a misconfigured deploy
 * fails at boot rather than silently logging live OTPs.
 *
 * MSG91 (student SMS) and SMTP (admin email) implement the same OtpSender
 * interface and drop in here — no caller changes.
 */
function createOtpSender(config: AppConfigService, consoleSender: ConsoleOtpSender): OtpSender {
  const channel = config.get('OTP_SENDER');

  if (channel === 'console') {
    if (config.isProduction) {
      throw new Error('OTP_SENDER=console is not allowed in production — configure MSG91.');
    }
    return consoleSender;
  }

  throw new Error(`OTP_SENDER="${channel}" is not implemented yet.`);
}

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    OtpService,
    ConsoleOtpSender,
    {
      provide: OTP_SENDER,
      inject: [AppConfigService, ConsoleOtpSender],
      useFactory: createOtpSender,
    },
    JwtAuthGuard,
    ActorGuard,
    PagePermissionGuard,
  ],
  exports: [TokenService, SessionService, JwtAuthGuard, ActorGuard, PagePermissionGuard],
})
export class AuthModule {}
