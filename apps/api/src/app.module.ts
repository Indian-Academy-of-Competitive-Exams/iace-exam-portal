import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { EventsModule } from './common/events';
import { MessagingModule } from './common/messaging';
import { AuditModule, AuditInterceptor, AuditContextMiddleware } from './audit';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AdminsModule } from './admins';
import { StudentsModule } from './students/students.module';
import { BranchesModule } from './branches/branches.module';
import { MeModule } from './me/me.module';
import { ConfigsModule } from './configs';
import { ImportsModule } from './imports/imports.module';
import { QuestionsModule } from './questions';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ActorGuard } from './auth/guards/actor.guard';
import { FeaturePermissionGuard } from './auth/guards/feature-permission.guard';
import { SuperAdminGuard } from './auth/guards/super-admin.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { RequestIdMiddleware } from './common/request-id';

/**
 * Guards run in registration order and every route is protected by default — a new endpoint is
 * authenticated unless it explicitly opts out with @Public().
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    StorageModule,
    EventsModule,
    MessagingModule,
    AuditModule,
    AuthModule,
    AdminsModule,
    StudentsModule,
    MeModule,
    BranchesModule,
    ConfigsModule,
    ImportsModule,
    QuestionsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: FeaturePermissionGuard },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
  ],
})
export class AppModule implements NestModule {
  /** Runs before everything else, so the id exists for guards and the filter. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AuditContextMiddleware).forRoutes('*');
  }
}
