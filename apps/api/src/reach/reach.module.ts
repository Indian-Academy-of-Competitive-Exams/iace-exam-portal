import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AccessResolverService } from './access-resolver.service';
import { AccessCacheListener } from './access-cache.listener';

/** Who a test reaches, read from the tables `access` owns; writes nothing, so `notifications` can ask without importing `access`. */
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [AccessResolverService, AccessCacheListener],
  exports: [AccessResolverService],
})
export class ReachModule {}
