import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EventsModule } from '../common/events';
import { AppConfigService } from '../config/app-config.service';
import { OTP_SENDERS } from '../config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin/pin.service';
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

  if (channel === OTP_SENDERS.CONSOLE) {
    if (config.isProduction) {
      throw new Error('OTP_SENDER=console is not allowed in production — configure MSG91.');
    }
    return consoleSender;
  }

  throw new Error(`OTP_SENDER="${channel}" is not implemented yet.`);
}

@Module({
  // Its own infra, declared rather than assumed (docs/03 §4.5). Redis is not
  // optional here: OTP, sessions, device binding and the PIN lockout ladder all
  // live there and nowhere else.
  imports: [AppConfigModule, PrismaModule, RedisModule, EventsModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    OtpService,
    PinService,
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
  exports: [
    // AuthService for the student's own PIN change: it owns verification, the
    // lockout ladder, session revocation and token issuance, and MeController
    // must not reimplement any of the four.
    AuthService,
    TokenService,
    SessionService,
    PinService,
    JwtAuthGuard,
    ActorGuard,
    PagePermissionGuard,
  ],
})
export class AuthModule {}
