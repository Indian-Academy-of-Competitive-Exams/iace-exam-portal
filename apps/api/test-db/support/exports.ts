import { randomUUID } from 'node:crypto';
import { type Job } from 'bullmq';
import {
  ADMIN_EXPORT_ROUTES,
  ERROR_CODE_STATUS,
  ErrorCodes,
  EXPORT_JOB_STATES,
  exportJobSchema,
  exportStartedSchema,
} from '@iace/contracts';
import { AuditService } from '../../src/audit';
import { ExportJobsService } from '../../src/common/exporting';
import { ExportBuilders } from '../../src/exports/export-builders';
import { ExportsController } from '../../src/exports/exports.controller';
import { ExportsProcessor } from '../../src/exports/exports.processor';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { FakeStorage, fakeQueueFailures } from '../../test/support/fakes';

type BuilderArgs = ConstructorParameters<typeof ExportBuilders>;

/** The owners a test's exports reach; the rest are never called by the kind under test. */
export interface ExportOwners {
  questions?: BuilderArgs[1];
  rollups?: BuilderArgs[2];
  reports?: BuilderArgs[3];
  analytics?: BuilderArgs[4];
  access?: BuilderArgs[5];
  grants?: BuilderArgs[6];
  announcements?: BuilderArgs[7];
}

interface InlineJob {
  id: string;
  name: string;
  data: unknown;
  returnvalue: unknown;
  state: 'completed' | 'failed';
  getState: () => Promise<string>;
}

/** BullMQ's surface the export flow touches, run in process: an add has been worked when it resolves. */
class InlineQueue {
  private readonly jobs = new Map<string, InlineJob>();
  worker: ExportsProcessor | undefined;

  async add(name: string, data: unknown, opts: { jobId?: string; delay?: number } = {}) {
    // A delayed add is the hour-later discard, which no test waits for.
    if (opts.delay !== undefined) return;
    const job: InlineJob = {
      id: opts.jobId ?? randomUUID(),
      name,
      data,
      returnvalue: null,
      state: 'failed',
      getState: () => Promise.resolve(job.state),
    };
    this.jobs.set(job.id, job);
    try {
      job.returnvalue = await this.worker?.process(job as unknown as Job);
      job.state = 'completed';
    } catch {
      job.state = 'failed';
    }
  }

  getJob(id: string): Promise<InlineJob | undefined> {
    return Promise.resolve(this.jobs.get(id));
  }
}

/** The real service, processor and collecting controller, wired so a test's app can mount them. */
export function inlineExports(prisma: PrismaService, owners: ExportOwners) {
  const storage = new FakeStorage() as never;
  const queue = new InlineQueue();
  const audit = new AuditService(prisma, storage);
  const unused = undefined as never;
  const builders = new ExportBuilders(
    prisma,
    owners.questions ?? unused,
    owners.rollups ?? unused,
    owners.reports ?? unused,
    owners.analytics ?? unused,
    owners.access ?? unused,
    owners.grants ?? unused,
    owners.announcements ?? unused,
    audit,
  );
  queue.worker = new ExportsProcessor(
    builders,
    storage,
    audit,
    queue as never,
    fakeQueueFailures(),
  );
  const jobs = new ExportJobsService(queue as never, storage);

  /** tsx emits no decorator metadata, so Nest cannot inject by type; the routes are inherited whole. */
  class Collect extends ExportsController {
    constructor() {
      super(jobs);
    }
  }
  return { jobs, Collect };
}

/** Asks, waits and collects as the admin client does; a refused build answers as the old request did. */
export async function fetchExport(baseUrl: string, path: string): Promise<Response> {
  const started = await fetch(`${baseUrl}${path}`, { method: 'POST' });
  if (!started.ok) return started;
  const { id } = exportStartedSchema.parse(((await started.json()) as { data: unknown }).data);

  const polled = await fetch(`${baseUrl}${ADMIN_EXPORT_ROUTES.job(id)}`);
  const job = exportJobSchema.parse(((await polled.json()) as { data: unknown }).data);
  if (job.state === EXPORT_JOB_STATES.DONE)
    return fetch(`${baseUrl}${ADMIN_EXPORT_ROUTES.file(id)}`);
  const error = job.error ?? { code: ErrorCodes.INTERNAL, message: 'not finished' };
  return Response.json({ success: false, error }, { status: ERROR_CODE_STATUS[error.code] });
}
