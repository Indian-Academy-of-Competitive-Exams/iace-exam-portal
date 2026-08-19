import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuditContext } from '../src/audit/audit.context';

describe('AuditContext', () => {
  it('carries what a service put in it, out to whoever reads it after', () => {
    const context = new AuditContext();

    context.run(() => {
      context.setChanged({ isTestBlocked: { from: true, to: false } });
      context.setEntityId('stu_1');
      assert.deepEqual(context.current()?.changed, { isTestBlocked: { from: true, to: false } });
      assert.equal(context.current()?.entityId, 'stu_1');
    });
  });

  /**
   * The failure this prevents: a store that does not survive an await is a store every
   * service writes into and nothing ever reads, and every diff comes out null.
   */
  it('survives an await, because every service method is async', async () => {
    const context = new AuditContext();

    await context.run(async () => {
      await Promise.resolve();
      context.setChanged({ name: { from: 'a', to: 'b' } });
      await Promise.resolve();
      assert.deepEqual(context.current()?.changed, { name: { from: 'a', to: 'b' } });
    });
  });

  it('keeps two concurrent requests apart', async () => {
    const context = new AuditContext();

    const one = context.run(async () => {
      context.setEntityId('a');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return context.current()?.entityId;
    });
    const two = context.run(async () => {
      context.setEntityId('b');
      return context.current()?.entityId;
    });

    assert.deepEqual(await Promise.all([one, two]), ['a', 'b']);
  });

  /** Outside a request there is no store, and a setter must not throw for want of one. */
  it('is inert outside a request', () => {
    const context = new AuditContext();

    assert.equal(context.current(), undefined);
    assert.doesNotThrow(() => context.setChanged({ a: { from: 1, to: 2 } }));
  });
});
