import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ActorGuard } from './auth/guards/actor.guard';
import { PagePermissionGuard } from './auth/guards/page-permission.guard';

/**
 * Guards run in registration order and every route is protected by default —
 * a new endpoint is authenticated unless it explicitly opts out with @Public().
 * That way forgetting a decorator locks a route down instead of exposing it.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    StorageModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: PagePermissionGuard },
  ],
})
export class AppModule {}
