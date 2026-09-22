import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { QUEUE_NAMES } from '../queue/queues';
import { AuditArchiveProcessor } from './audit-archive.processor';
import { AuditContext } from './audit.context';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { API_ROLES, onRole, servesRole } from '../config/api-role';

/** Global: every feature module contributes a diff, and none should have to import this. */
@Global()
@Module({
  imports: [PrismaModule, QueueModule],
  controllers: onRole([API_ROLES.CORE], [AuditController]),
  providers: [AuditService, AuditContext, ...onRole([API_ROLES.WORKER], [AuditArchiveProcessor])],
  exports: [AuditService, AuditContext],
})
export class AuditModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.AUDIT_ARCHIVE) private readonly archiveQueue: Queue) {}

  /** Fixed scheduler id: what stops a redeploy from stacking a second daily schedule. */
  async onModuleInit(): Promise<void> {
    // The container that runs the jobs is the one that schedules them.
    if (!servesRole(API_ROLES.WORKER)) return;

    await this.archiveQueue.upsertJobScheduler(QUEUE_NAMES.AUDIT_ARCHIVE, {
      pattern: '30 2 * * *',
      tz: 'UTC',
    });
  }
}
