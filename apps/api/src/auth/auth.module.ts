import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminsModule } from '../admins';
import { RedisModule } from '../redis/redis.module';
import { EventsModule } from '../common/events';
import { MessagingModule } from '../common/messaging';
import { AdminSessionsListener } from './admin-sessions.listener';
import { StudentSessionsListener } from './student-sessions.listener';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { OtpService } from './otp/otp.service';
import { API_ROLES, onRole } from '../config/api-role';

@Module({
  // Its own infra, declared rather than assumed (docs/03 §4.5). Redis is not optional here: OTP, sessions and device binding all live there and nowhere else.
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    EventsModule,
    // Who an admin is and what they may do is AdminsService's one read, for the guard and the identity alike.
    AdminsModule,
    // The OTP is one outbound message among several to come; auth no longer owns the delivery channel, only the decision to send.
    MessagingModule,
    JwtModule.register({}),
  ],
  controllers: onRole([API_ROLES.CORE], [AuthController]),
  providers: [
    AuthService,
    TokenService,
    SessionService,
    AdminSessionsListener,
    StudentSessionsListener,
    OtpService,
  ],
  exports: [
    // AuthService for the desk code an admin reads out: the students module asks, and the code stays auth's.
    AuthService,
    TokenService,
    SessionService,
  ],
})
export class AuthModule {}
