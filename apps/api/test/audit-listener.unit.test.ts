import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AUDIT_FEATURE } from '@iace/contracts';
import { type AuditService } from '../src/audit/audit.service';
import { AuditListener } from '../src/audit/audit.listener';

const EVENT = {
  feature: AUDIT_FEATURE.STUDENT,
  action: AUDIT_ACTION.BLOCK,
  entityId: 'stu_1',
  actorType: AUDIT_ACTOR_TYPE.ADMIN,
  actorId: 'adm_1',
  changed: { isTestBlocked: { from: false, to: true } },
  importLogId: null,
  requestId: 'req_1',
};

describe('AuditListener', () => {
  /** The request already succeeded, so an audit write that throws must never reach the producer. */
  it('swallows a failing write rather than failing the request behind it', async () => {
    const service = {
      record: () => Promise.reject(new Error('postgres is down')),
    } as unknown as AuditService;

    await assert.doesNotReject(() => new AuditListener(service).onRowAction(EVENT));
  });

  it('hands the event to the service unchanged', async () => {
    const seen: unknown[] = [];
    const service = {
      record: (event: unknown) => {
        seen.push(event);
        return Promise.resolve();
      },
    } as unknown as AuditService;

    await new AuditListener(service).onRowAction(EVENT);

    assert.deepEqual(seen, [EVENT]);
  });
});
