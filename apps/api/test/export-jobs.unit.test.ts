import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Job } from 'bullmq';
import {
  ActorTypes,
  AppException,
  EXPORT_JOB_STATES,
  EXPORT_KINDS,
  ErrorCodes,
} from '@iace/contracts';
import { type AuditEntry } from '../src/audit/audit.service';
import {
  EXPORT_FILE_TTL_MS,
  EXPORT_JOBS,
  ExportJobsService,
  exportFileKey,
  type ExportJobData,
} from '../src/common/exporting';
import { type AuthenticatedUser } from '../src/common/security';
import { type BuiltExport } from '../src/exports/export-builders';
import { ExportsProcessor } from '../src/exports/exports.processor';
import { FakeQueue, FakeStorage, fakeQueueFailures } from './support/fakes';

const admin = (id: string): AuthenticatedUser => ({
  id,
  actor: ActorTypes.ADMIN,
  sessionId: 's',
  isSuperAdmin: false,
  isActive: true,
  permissions: {},
});
const ASKER = admin('adm_asker');
const request = { kind: EXPORT_KINDS.SERIES_GRANTS, seriesId: 'ser_1' } as const;

/** One stored job, as BullMQ hands it back: its name, data, state and what the worker returned. */
function queueHolding(job: { name: string; data: unknown; state: string; returnvalue: unknown }) {
  const held = { ...job, getState: () => Promise.resolve(job.state) };
  return { add: () => Promise.resolve(), getJob: () => Promise.resolve(held) } as never;
}

function processorWith(build: () => Promise<BuiltExport>) {
  const storage = new FakeStorage();
  const queue = new FakeQueue();
  const entries: AuditEntry[] = [];
  const audit = { record: (entry: AuditEntry) => Promise.resolve(void entries.push(entry)) };
  const processor = new ExportsProcessor(
    { build } as never,
    storage as never,
    audit as never,
    queue.asQueue(),
    fakeQueueFailures(),
  );
  const job = (name: string, data: unknown) => ({ id: 'job_1', name, data }) as unknown as Job;
  return { processor, storage, queue, entries, job };
}

describe('ExportJobsService — a file is its asker’s alone', () => {
  const data: ExportJobData = {
    request,
    viewer: { id: ASKER.id, isSuperAdmin: false, isActive: true },
  };
  const done = { name: EXPORT_JOBS.BUILD, data, state: 'completed' };

  /** THE failure this prevents: one admin collecting another's roster by guessing a job id. */
  it('answers another admin as though the file did not exist', async () => {
    const file = { key: exportFileKey('job_1'), kind: request.kind };
    const jobs = new ExportJobsService(
      queueHolding({ ...done, returnvalue: { file } }),
      new FakeStorage() as never,
    );
    const notFound = (error: unknown) =>
      AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

    await assert.rejects(jobs.status('job_1', 'adm_other'), notFound);
    await assert.rejects(jobs.file('job_1', 'adm_other'), notFound);
    assert.equal((await jobs.status('job_1', ASKER.id)).state, EXPORT_JOB_STATES.DONE);
  });

  it('hands a refusal the builder raised back to its asker by its code', async () => {
    const error = { code: ErrorCodes.EXPORT_TOO_LARGE, message: 'Too many rows' };
    const jobs = new ExportJobsService(
      queueHolding({ ...done, returnvalue: { error } }),
      new FakeStorage() as never,
    );

    assert.deepEqual(await jobs.status('job_1', ASKER.id), {
      id: 'job_1',
      state: EXPORT_JOB_STATES.FAILED,
      error,
    });
  });
});

describe('ExportJobsService — collecting a file', () => {
  const key = exportFileKey('job_1');
  const finished = {
    name: EXPORT_JOBS.BUILD,
    data: { request, viewer: { id: ASKER.id, isSuperAdmin: false, isActive: true } },
    state: 'completed',
    returnvalue: { file: { key, kind: request.kind } },
  };
  const missing = Object.assign(new Error('The specified key does not exist.'), {
    name: 'NoSuchKey',
  });
  const withStorage = (read: () => Promise<Buffer>) =>
    new ExportJobsService(queueHolding(finished), { read } as never);

  it('hands the asker the stored file', async () => {
    const jobs = withStorage(() => Promise.resolve(Buffer.from('xlsx')));

    const { kind, workbook } = await jobs.file('job_1', ASKER.id);

    assert.equal(kind, request.kind);
    assert.equal(workbook.toString(), 'xlsx');
  });

  /** THE failure this prevents: a file discarded before its job record is gone answering as a server fault. */
  it('answers a file already discarded as expired, as it does a job it no longer knows', async () => {
    const jobs = withStorage(() => Promise.reject(missing));
    const expired = (error: unknown) =>
      AppException.is(error) &&
      error.code === ErrorCodes.NOT_FOUND &&
      error.message === 'No such file, or it has expired';

    await assert.rejects(jobs.file('job_1', ASKER.id), expired);
  });

  it('lets a storage fault that is not a missing file through as a fault', async () => {
    const outage = new Error('s3 is down');
    const jobs = withStorage(() => Promise.reject(outage));

    await assert.rejects(jobs.file('job_1', ASKER.id), (error: unknown) => error === outage);
  });
});

describe('ExportsProcessor — the file is built off the request, logged, and later discarded', () => {
  const viewer = { id: ASKER.id, isSuperAdmin: false, isActive: true };

  it('stores the file, logs the export against its asker and books its own discard', async () => {
    const built: BuiltExport = {
      kind: request.kind,
      workbook: Buffer.from('xlsx'),
      audit: {
        feature: 'TEST_SERIES',
        entityId: 'ser_1',
        changed: { rows: { from: null, to: 3 } },
      },
    };
    const { processor, storage, queue, entries, job } = processorWith(() => Promise.resolve(built));

    const outcome = await processor.process(job(EXPORT_JOBS.BUILD, { request, viewer }));

    const key = exportFileKey('job_1');
    assert.deepEqual(outcome, { file: { key, kind: request.kind } });
    assert.equal(storage.objects.get(key)?.toString(), 'xlsx');
    assert.deepEqual(queue.jobs, [
      { name: EXPORT_JOBS.DISCARD, data: { key }, jobId: undefined, delay: EXPORT_FILE_TTL_MS },
    ]);
    assert.equal(entries[0]?.actorId, ASKER.id);
    assert.equal(entries[0]?.entityId, 'ser_1');

    await processor.process(job(EXPORT_JOBS.DISCARD, { key }));
    assert.equal(storage.objects.has(key), false);
  });

  /** A refusal is an answer, not a fault: retrying it would only refuse again. */
  it('completes a refused build with the refusal, storing and logging nothing', async () => {
    const refusal = new AppException(ErrorCodes.EXPORT_TOO_LARGE, 'Too many rows');
    const { processor, storage, entries, job } = processorWith(() => Promise.reject(refusal));

    const outcome = await processor.process(job(EXPORT_JOBS.BUILD, { request, viewer }));

    assert.deepEqual(outcome, {
      error: { code: ErrorCodes.EXPORT_TOO_LARGE, message: 'Too many rows' },
    });
    assert.equal(storage.objects.size, 0);
    assert.equal(entries.length, 0);
  });

  it('lets an unexpected fault fail the job, so the queue retries it', async () => {
    const { processor, job } = processorWith(() => Promise.reject(new Error('db down')));

    await assert.rejects(processor.process(job(EXPORT_JOBS.BUILD, { request, viewer })), /db down/);
  });
});
