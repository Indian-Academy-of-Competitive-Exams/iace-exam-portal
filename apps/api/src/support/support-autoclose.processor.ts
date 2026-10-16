import { Injectable, Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { QueueFailures } from '../common/metrics/queue-failures';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { ReportingWorkerHost } from '../queue/reporting-worker-host';
import { SupportAdminService } from './support-admin.service';
import { SupportService } from './support.service';

@Injectable()
@Processor(QUEUE_NAMES.SUPPORT_AUTOCLOSE, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.SUPPORT_AUTOCLOSE].concurrency,
})
export class SupportAutocloseProcessor extends ReportingWorkerHost {
  private readonly logger = new Logger(SupportAutocloseProcessor.name);

  constructor(
    private readonly support: SupportService,
    private readonly supportAdmin: SupportAdminService,
    failures: QueueFailures,
  ) {
    super(QUEUE_NAMES.SUPPORT_AUTOCLOSE, failures);
  }

  async process(): Promise<void> {
    const closed = await this.support.closeStale();
    if (closed > 0) this.logger.log(`Closed ${closed} quiet tickets`);
    const emailed = await this.supportAdmin.emailUnread();
    if (emailed > 0) this.logger.log(`Emailed ${emailed} unread replies`);
  }
}
