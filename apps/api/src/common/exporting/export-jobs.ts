import { randomUUID } from 'node:crypto';
import { Global, Injectable, Module } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import {
  AppException,
  EXPORT_JOB_STATES,
  EXPORT_KINDS,
  ErrorCodes,
  type ExportJob,
  type ExportKind,
  type ExportStarted,
  type QuestionExportQuery,
  type ReportKey,
  type ReportQuery,
  type RowActionExportQuery,
  type StudentExportQuery,
} from '@iace/contracts';
import { QUEUE_NAMES } from '../../queue/queues';
import { StorageService } from '../../storage/storage.service';
import { type AuthenticatedUser } from '../security/authenticated-user';

export const EXPORT_JOBS = { BUILD: 'build', DISCARD: 'discard' } as const;

/** Every report downloads under its own key, so the request names the report beside this. */
export const REPORT_EXPORT = 'report' as const;

/** As long as a finished job is kept: the file and the record of it go together. */
export const EXPORT_FILE_TTL_MS = 60 * 60 * 1000;

/** As much of the asker as a builder scopes by — never the session, which a job outlives. */
export interface ExportViewer {
  id: string;
  isSuperAdmin: boolean;
  isActive: boolean;
}

export type ExportRequest =
  | { kind: typeof EXPORT_KINDS.QUESTIONS; query: QuestionExportQuery }
  | {
      kind: typeof EXPORT_KINDS.STUDENTS | typeof EXPORT_KINDS.STUDENT_PERFORMANCE;
      query: StudentExportQuery;
    }
  | { kind: typeof EXPORT_KINDS.TEST_REPORT; testId: string }
  | { kind: typeof EXPORT_KINDS.SERIES_GRANTS; seriesId: string }
  | { kind: typeof EXPORT_KINDS.ANNOUNCEMENT_DELIVERIES; announcementId: string }
  | { kind: typeof EXPORT_KINDS.AUDIT_LOG; query: RowActionExportQuery }
  | { kind: typeof REPORT_EXPORT; key: ReportKey; query: ReportQuery };

export interface ExportJobData {
  request: ExportRequest;
  viewer: ExportViewer;
}

/** A refusal the builder raised is the asker's answer, so it completes the job rather than retrying it. */
export type ExportOutcome =
  | { file: { key: string; kind: ExportKind }; error?: never }
  | { error: { code: AppException['code']; message: string }; file?: never };

export interface DiscardJobData {
  key: string;
}

export const exportFileKey = (jobId: string) => `exports/${jobId}.xlsx`;

/** Asking for a file, and collecting it: the build runs on a worker, never on the request that asked. */
@Injectable()
export class ExportJobsService {
  constructor(
    @InjectQueue(QUEUE_NAMES.EXPORTS) private readonly queue: Queue,
    private readonly storage: StorageService,
  ) {}

  async start(request: ExportRequest, user: AuthenticatedUser): Promise<ExportStarted> {
    const id = randomUUID();
    const viewer = { id: user.id, isSuperAdmin: user.isSuperAdmin, isActive: user.isActive };
    const data: ExportJobData = { request, viewer };
    await this.queue.add(EXPORT_JOBS.BUILD, data, { jobId: id });
    return { id };
  }

  async status(id: string, adminId: string): Promise<ExportJob> {
    const job = await this.mine(id, adminId);
    const state = await job.getState();
    if (state === 'failed') {
      return {
        id,
        state: EXPORT_JOB_STATES.FAILED,
        error: { code: ErrorCodes.INTERNAL, message: 'That file could not be made. Try again.' },
      };
    }
    if (state !== 'completed') return { id, state: EXPORT_JOB_STATES.RUNNING, error: null };
    const outcome = job.returnvalue as ExportOutcome;
    if (outcome.error) return { id, state: EXPORT_JOB_STATES.FAILED, error: outcome.error };
    return { id, state: EXPORT_JOB_STATES.DONE, error: null };
  }

  async file(id: string, adminId: string): Promise<{ kind: ExportKind; workbook: Buffer }> {
    const job = await this.mine(id, adminId);
    const outcome = job.returnvalue as ExportOutcome | null;
    if (!outcome?.file) throw new AppException(ErrorCodes.NOT_FOUND, 'That file is not ready');
    return { kind: outcome.file.kind, workbook: await this.storage.read(outcome.file.key) };
  }

  /** Someone else's file reads as no file at all, so an id cannot be probed for. */
  private async mine(id: string, adminId: string) {
    const job = await this.queue.getJob(id);
    const data = job?.data as ExportJobData | undefined;
    if (job?.name !== EXPORT_JOBS.BUILD || data?.viewer.id !== adminId) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such file, or it has expired');
    }
    return job;
  }
}

@Global()
@Module({
  providers: [ExportJobsService],
  exports: [ExportJobsService],
})
export class ExportJobsModule {}
