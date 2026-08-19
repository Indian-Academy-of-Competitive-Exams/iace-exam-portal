import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AUDIT_FEATURE, ActorTypes } from '@iace/contracts';
import { DOMAIN_EVENTS } from '../src/common/events/event-catalog';
import { AuditContext } from '../src/audit/audit.context';
import { AuditInterceptor } from '../src/audit/audit.interceptor';
import { TOGGLE_ACTIONS } from '../src/audit/audit.decorator';
import { FakeEventBus } from './support/fakes';

function harness(route: unknown, request: Record<string, unknown>) {
  const bus = new FakeEventBus();
  const context = new AuditContext();
  const reflector = { getAllAndOverride: () => route } as never;
  const interceptor = new AuditInterceptor(reflector, context, bus as never);

  const execution = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  return { bus, context, interceptor, execution };
}

const ADMIN_REQUEST = {
  params: { id: 'stu_1' },
  body: { isTestBlocked: true },
  user: { id: 'adm_1', actor: ActorTypes.ADMIN },
  requestId: 'req_1',
};

describe('AuditInterceptor', () => {
  it('emits one event with the actor, the entity and the resolved action', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.tests };
    const { bus, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
    );

    assert.equal(bus.events.length, 1);
    assert.equal(bus.events[0]?.name, DOMAIN_EVENTS.AUDIT_ROW_ACTION);
    assert.equal(bus.events[0]?.payload.action, AUDIT_ACTION.BLOCK);
    assert.equal(bus.events[0]?.payload.entityId, 'stu_1');
    assert.equal(bus.events[0]?.payload.actorId, 'adm_1');
  });

  /** A refused write is not a change, so a thrown request must leave no trace. */
  it('emits nothing when the handler throws', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { bus, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, {
        handle: () => throwError(() => new Error('refused')),
      } as never),
    ).then(
      () => assert.fail('should have thrown'),
      () => undefined,
    );

    assert.equal(bus.events.length, 0);
  });

  it('emits nothing for a route carrying no @Audit', async () => {
    const { bus, interceptor, execution } = harness(undefined, ADMIN_REQUEST);

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'x' }) } as never),
    );

    assert.equal(bus.events.length, 0);
  });

  /** A create has no id in the path — it is in what the handler just returned. */
  it('falls back to the response id when the route has no param', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.CREATE };
    const { bus, interceptor, execution } = harness(route, { ...ADMIN_REQUEST, params: {} });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_new' }) } as never),
    );

    assert.equal(bus.events[0]?.payload.entityId, 'stu_new');
  });

  it('carries the diff the service contributed', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { bus, context, interceptor, execution } = harness(route, ADMIN_REQUEST);

    await context.run(async () => {
      context.setChanged({ fullName: { from: 'A', to: 'B' } });
      await firstValueFrom(
        interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
      );
    });

    assert.deepEqual(bus.events[0]?.payload.changed, { fullName: { from: 'A', to: 'B' } });
  });

  it('records a student acting on themselves as a STUDENT actor', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT_PROFILE, action: AUDIT_ACTION.UPDATE };
    const { bus, interceptor, execution } = harness(route, {
      ...ADMIN_REQUEST,
      params: {},
      user: { id: 'stu_9', actor: ActorTypes.STUDENT },
    });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_9' }) } as never),
    );

    assert.equal(bus.events[0]?.payload.actorType, AUDIT_ACTOR_TYPE.STUDENT);
    assert.equal(bus.events[0]?.payload.actorId, 'stu_9');
  });

  /**
   * The failure this prevents: with no token, `actorTypeOf` fell through to ADMIN and filed a row
   * with a null actorId under it — the log naming an admin for something no admin did. "Unreachable"
   * was a claim about a guard registered in another file, not about this function.
   */
  it('records a request with no authenticated user as SCRIPT, never ADMIN', async () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE };
    const { bus, interceptor, execution } = harness(route, {
      ...ADMIN_REQUEST,
      params: { id: 'stu_1' },
      user: undefined,
    });

    await firstValueFrom(
      interceptor.intercept(execution, { handle: () => of({ id: 'stu_1' }) } as never),
    );

    assert.equal(bus.events[0]?.payload.actorType, AUDIT_ACTOR_TYPE.SCRIPT);
    assert.equal(bus.events[0]?.payload.actorId, null);
  });
});
