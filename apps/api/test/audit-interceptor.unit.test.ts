import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AUDIT_FEATURE, ActorTypes } from '@iace/contracts';
import { AuditContext } from '../src/audit/audit.context';
import { AuditInterceptor } from '../src/audit/audit.interceptor';
import { TOGGLE_ACTIONS } from '../src/audit/audit.decorator';
import { type AuditEntry, type AuditService } from '../src/audit/audit.service';

function harness(
  route: unknown,
  request: Record<string, unknown>,
  write: (entry: AuditEntry) => Promise<void> = () => Promise.resolve(),
) {
  const entries: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      entries.push(entry);
      return write(entry);
    },
  } as unknown as AuditService;
  const context = new AuditContext();
  const reflector = { getAllAndOverride: () => route } as never;
  const interceptor = new AuditInterceptor(reflector, context, audit);

  const execution = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  return { entries, context, interceptor, execution };
}

const ADMIN_REQUEST = {
  params: { id: 'stu_1' },
  body: { isTestBlocked: true },
  user: { id: 'adm_1', actor: ActorTypes.ADMIN },
  requestId: 'req_1',
};

describe('AuditInterceptor', () => {
  it('records one row with the actor, the entity and the resolved action', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.tests };
    const { entries, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.action, AUDIT_ACTION.BLOCK);
    assert.equal(entries[0]?.entityId, 'stu_1');
    assert.equal(entries[0]?.actorId, 'adm_1');
  });

  it('answers the request even when the audit write fails', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { interceptor, execution } = harness(route, ADMIN_REQUEST, () =>
      Promise.reject(new Error('postgres is down')),
    );

    const answer = await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(answer, { id: 'stu_1' });
  });

  /** A refused write is not a change, so a thrown request must leave no trace. */
  it('records nothing when the handler throws', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { entries, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, {
        handle: () => throwError(() => new Error('refused')),
      } as never),
    ).then(
      () => assert.fail('should have thrown'),
      () => undefined,
    );

    assert.equal(entries.length, 0);
  });

  it('records nothing for a route carrying no @Audit', async () => {
    const { entries, interceptor, execution } = harness(undefined, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'x' }) } as never),
    );

    assert.equal(entries.length, 0);
  });

  /** A create has no id in the path — it is in what the handler just returned. */
  it('falls back to the response id when the route has no param', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.CREATE };
    const { entries, interceptor, execution } = harness(route, { ...ADMIN_REQUEST, params: {} });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_new' }) } as never),
    );

    assert.equal(entries[0]?.entityId, 'stu_new');
  });

  it('carries the diff the service contributed', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { entries, context, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await context.run(async () => {
      context.setChanged({ fullName: { from: 'A', to: 'B' } });
      await firstValueFrom(
        interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
      );
    });

    assert.deepEqual(entries[0]?.changed, { fullName: { from: 'A', to: 'B' } });
  });

  it('records a student acting on themselves as a STUDENT actor', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT_PROFILE, action: AUDIT_ACTION.UPDATE };
    const { entries, interceptor, execution } = harness(route, {
      ...ADMIN_REQUEST,
      params: {},
      user: { id: 'stu_9', actor: ActorTypes.STUDENT },
    });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_9' }) } as never),
    );

    assert.equal(entries[0]?.actorType, AUDIT_ACTOR_TYPE.STUDENT);
    assert.equal(entries[0]?.actorId, 'stu_9');
  });

  /**
   * The failure this prevents: with no token, `actorTypeOf` fell through to ADMIN and filed a row
   * with a null actorId under it — the log naming an admin for something no admin did. "Unreachable"
   * was a claim about a guard registered in another file, not about this function.
   */
  it('records a request with no authenticated user as SCRIPT, never ADMIN', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { entries, interceptor, execution } = harness(route, {
      ...ADMIN_REQUEST,
      params: { id: 'stu_1' },
      user: undefined,
    });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
    );

    assert.equal(entries[0]?.actorType, AUDIT_ACTOR_TYPE.SCRIPT);
    assert.equal(entries[0]?.actorId, null);
  });

  /** A clone posts to the source's path; the row it made is the one the log must name. */
  it('names the row a create made, not the row in its path', async () => {
    const route = { feature: AUDIT_FEATURE.BASE_CONFIG, action: AUDIT_ACTION.CREATE };
    const { entries, interceptor, execution } = harness(route, {
      ...ADMIN_REQUEST,
      params: { id: 'cfg_source' },
    });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'cfg_copy' }) } as never),
    );

    assert.equal(entries[0]?.entityId, 'cfg_copy');
  });

  /** A patch diff covers every column; an untracked update does not, so only the first may vanish. */
  it('records nothing for a patch that changed nothing, and still records an untracked update', async () => {
    const route = { feature: AUDIT_FEATURE.EXAM_TAXONOMY, action: AUDIT_ACTION.UPDATE };
    const { entries, context, interceptor, execution } = harness(route, ADMIN_REQUEST);
    const save = () =>
      firstValueFrom(
        interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
      );

    await context.run(async () => {
      context.setPatchDiff(null);
      await save();
    });
    assert.equal(entries.length, 0);

    await context.run(async () => {
      context.setChanged(null);
      await save();
    });
    assert.equal(entries.length, 1);
  });
});
