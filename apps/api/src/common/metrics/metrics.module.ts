import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { QueueModule } from '../../queue/queue.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestObserverMiddleware } from './request-observer.middleware';
import { QueueFailures } from './queue-failures';

/** Global because anything worth counting is worth counting from wherever it happens. */
@Global()
@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, QueueModule],
  controllers: [MetricsController],
  providers: [MetricsService, QueueFailures, RequestObserverMiddleware],
  exports: [MetricsService, QueueFailures, RequestObserverMiddleware],
})
export class MetricsModule {}
