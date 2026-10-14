import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { type Job, type Queue } from 'bullmq';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AppException, XLSX_CONTENT_TYPE } from '@iace/contracts';
import { AuditService } from '../audit';
import {
  EXPORT_FILE_TTL_MS,
  EXPORT_JOBS,
  exportFileKey,
  type DiscardJobData,
  type ExportJobData,
  type ExportOutcome,
} from '../common/exporting';
import { QueueFailures } from '../common/metrics/queue-failures';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { ReportingWorkerHost } from '../queue/reporting-worker-host';
import { StorageService } from '../storage/storage.service';
import { ExportBuilders, type BuiltExport } from './export-builders';

/** Builds an asked-for file off the request path, keeps it an hour, and logs it as the request once did. */
@Injectable()
@Processor(QUEUE_NAMES.EXPORTS, { concurrency: QUEUE_POLICY[QUEUE_NAMES.EXPORTS].concurrency })
export class ExportsProcessor extends ReportingWorkerHost {
  private readonly logger = new Logger(ExportsProcessor.name);

  constructor(
    private readonly builders: ExportBuilders,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.EXPORTS) private readonly exportsQueue: Queue,
    failures: QueueFailures,
  ) {
    super(QUEUE_NAMES.EXPORTS, failures);
  }

  async process(job: Job): Promise<ExportOutcome | null> {
    if (job.name === EXPORT_JOBS.DISCARD) {
      await this.storage.remove((job.data as DiscardJobData).key);
      return null;
    }

    const { request, viewer } = job.data as ExportJobData;
    let built: BuiltExport;
    try {
      built = await this.builders.build(request, viewer);
    } catch (error) {
      if (AppException.is(error)) return { error: { code: error.code, message: error.message } };
      throw error;
    }

    const key = exportFileKey(String(job.id));
    await this.storage.upload(key, built.workbook, XLSX_CONTENT_TYPE);
    const discard: DiscardJobData = { key };
    await this.exportsQueue.add(EXPORT_JOBS.DISCARD, discard, { delay: EXPORT_FILE_TTL_MS });

    const entry = {
      ...built.audit,
      action: AUDIT_ACTION.EXPORT,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      actorId: viewer.id,
    };
    // The file exists either way: losing its record must never cost the asker the file.
    await this.audit.record(entry).catch((error: unknown) => {
      this.logger.error(`Audit write failed for export ${String(job.id)}`, error);
    });
    return { file: { key, kind: built.kind } };
  }
}
