import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AUDIT_FEATURE } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { AuditListener } from '../src/audit/audit.listener';
import { FakePrisma, FakeStorage } from './support/fakes';

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

describe('AuditService.record', () => {
  it('writes the row exactly as the event describes it', async () => {
    const prisma = new FakePrisma();
    await new AuditService(prisma as never, new FakeStorage() as never).record(EVENT);

    assert.equal(prisma.rowActionLogs.length, 1);
    assert.equal(prisma.rowActionLogs[0]?.entityId, 'stu_1');
    assert.equal(prisma.rowActionLogs[0]?.action, AUDIT_ACTION.BLOCK);
    assert.deepEqual(prisma.rowActionLogs[0]?.changed, {
      isTestBlocked: { from: false, to: true },
    });
  });
});

describe('AuditListener', () => {
  /**
   * The failure this prevents: an audit write that throws must never reach the producer.
   * The request already succeeded — failing it now would undo a write that happened.
   */
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
