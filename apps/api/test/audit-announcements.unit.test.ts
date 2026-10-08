import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, from } from 'rxjs';
import {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_FEATURE,
  ActorTypes,
  type Announcement,
} from '@iace/contracts';
import { AuditContext } from '../src/audit/audit.context';
import { AuditInterceptor } from '../src/audit/audit.interceptor';
import { type AuditEntry, type AuditService } from '../src/audit/audit.service';
import { AnnouncementsController } from '../src/notifications/announcements.controller';

/** The send route as the app runs it: the real handler, behind the real interceptor reading its own metadata. */
async function auditedSend(sent: Partial<Announcement>): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  const context = new AuditContext();
  const controller = new AnnouncementsController(
    { send: () => Promise.resolve(sent) } as never,
    context,
  );
  const sender = { id: 'adm_1', actor: ActorTypes.ADMIN };
  const execution = {
    getType: () => 'http',
    getHandler: () => AnnouncementsController.prototype.send,
    getClass: () => AnnouncementsController,
    switchToHttp: () => ({ getRequest: () => ({ user: sender, params: {}, body: {} }) }),
  } as never;
  const next = { handle: () => from(controller.send(sender as never, {} as never)) };

  await context.run(() =>
    firstValueFrom(
      new AuditInterceptor(new Reflector(), context, audit).intercept(execution, next),
    ),
  );
  return entries;
}

describe('sending an announcement', () => {
  /** The failure this prevents: the list's "Sent by" column being the only record of who sent what to how many. */
  it('is filed against the announcement it made, by its sender, with how many it reached and how', async () => {
    const entries = await auditedSend({ id: 'ann_1', recipientCount: 412, paidChannels: ['SMS'] });

    assert.deepEqual(entries, [
      {
        feature: AUDIT_FEATURE.ANNOUNCEMENT,
        action: AUDIT_ACTION.CREATE,
        entityId: 'ann_1',
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        actorId: 'adm_1',
        changed: {
          recipients: { from: null, to: 412 },
          paidChannels: { from: null, to: ['SMS'] },
        },
      },
    ]);
  });
});
