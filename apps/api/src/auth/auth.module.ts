import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EventsModule } from '../common/events';
import { MessagingModule } from '../common/messaging';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin/pin.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ActorGuard } from './guards/actor.guard';
import { PagePermissionGuard } from './guards/page-permission.guard';

@Module({
  // Its own infra, declared rather than assumed (docs/03 §4.5). Redis is not
  // optional here: OTP, sessions, device binding and the PIN lockout ladder all
  // live there and nowhere else.
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    EventsModule,
    // The OTP is one outbound message among several to come; auth no longer
    // owns the delivery channel, only the decision to send.
    MessagingModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    OtpService,
    PinService,
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
