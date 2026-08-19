import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_FEATURE, FEATURE_KEYS, PERMISSION_LEVELS, fieldDiff } from '@iace/contracts';
import { AdminsController } from '../src/admins/admins.controller';
import {
  AdminsService,
  AUDITED_ADMIN_FIELDS,
  permissionAuditEntity,
} from '../src/admins/admins.service';
import { AUDIT_KEY, type AuditRoute } from '../src/audit/audit.decorator';
import { AuditContext } from '../src/audit';
import { FakeAdminsPrisma, makeAdminRow } from './support/fakes';

describe('the admin audit diff', () => {
  it('covers what an admin edit can change', () => {
    assert.deepEqual([...AUDITED_ADMIN_FIELDS], ['fullName', 'isSuperAdmin']);
  });

  /** Promotion to super admin bypasses every feature check, so it is the row to find. */
  it('reports a promotion to super admin', () => {
    const before = { fullName: 'R Kumar', isSuperAdmin: false };

    assert.deepEqual(fieldDiff(before, { ...before, isSuperAdmin: true }, AUDITED_ADMIN_FIELDS), {
      isSuperAdmin: { from: false, to: true },
    });
  });
});

describe('what files under FEATURE_PERMISSION', () => {
  const routeOf = (handler: keyof AdminsController) =>
    Reflect.getMetadata(AUDIT_KEY, AdminsController.prototype[handler]) as AuditRoute | undefined;

  /**
   * The failure this prevents: `entityId` under FEATURE_PERMISSION is an Admin id, set deliberately
   * by changeGrant. `POST admin/features` has no `:id` and returns a Feature, so the interceptor
   * fell back to the Feature's own id — making one column point at two tables, and reading as a
   * permission grant when registering a key grants nobody anything.
   */
  it('files only the two grant routes, never feature registration', () => {
    assert.equal(routeOf('grant')?.feature, AUDIT_FEATURE.FEATURE_PERMISSION);
    assert.equal(routeOf('revoke')?.feature, AUDIT_FEATURE.FEATURE_PERMISSION);
    assert.equal(routeOf('createFeature'), undefined);
  });
});

describe('permission grants', () => {
  /**
   * A grant has no row of its own to name, so the entity is the admin it was made about —
   * which is also who you are looking at when you ask the question.
   */
  it('files a grant against the admin who received it', () => {
    assert.deepEqual(
      permissionAuditEntity({ adminId: 'adm_2', key: 'STUDENT_MANAGEMENT', level: 'WRITE' }),
      {
        feature: AUDIT_FEATURE.FEATURE_PERMISSION,
        entityId: 'adm_2',
        changed: { STUDENT_MANAGEMENT: { from: null, to: 'WRITE' } },
      },
    );
  });

  it('records a revoke as the level going away', () => {
    assert.deepEqual(
      permissionAuditEntity({ adminId: 'adm_2', key: 'STUDENT_MANAGEMENT', level: 'WRITE' }, true)
        .changed,
      { STUDENT_MANAGEMENT: { from: 'WRITE', to: null } },
    );
  });
});

// ============================================================================
// Driving AdminsService inside a live AuditContext, the way the interceptor
// actually reads it — a pure-function test of permissionAuditEntity alone
// cannot catch setEntityId being left out of changeGrant.
// ============================================================================

function build(admins = [makeAdminRow({ id: 'adm_1' })]) {
  const prisma = new FakeAdminsPrisma(admins);
  const auditContext = new AuditContext();
  return { prisma, auditContext, service: new AdminsService(prisma.asService(), auditContext) };
}

async function withFeature(
  ctx: ReturnType<typeof build>,
  key: string = FEATURE_KEYS.STUDENT_MANAGEMENT,
): Promise<void> {
  await ctx.service.createFeature({ key });
}

describe('AdminsService grant/revoke — the entity the row is filed against', () => {
  /**
   * The failure this prevents: both routes return a Feature and neither has an `:id` param, so the
   * interceptor's fallback (`request.params.id ?? idOf(payload)`) would file the row against the
   * feature's own cuid — a perfectly valid-looking id that is simply the wrong entity, forever.
   */
  it('grant sets the entity id to the admin, not the feature the call returns', async () => {
    const ctx = build();
    await withFeature(ctx);
    const featureId = ctx.prisma.features[0]?.id;

    const feature = await ctx.auditContext.run(async () => {
      const result = await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
      assert.equal(ctx.auditContext.current()?.entityId, 'adm_1');
      return result;
    });

    // What the id-from-payload fallback would have picked instead — a different, valid-looking id.
    assert.equal(feature.id, featureId);
  });

  it('revoke sets the entity id to the admin too', async () => {
    const ctx = build();
    await withFeature(ctx);
    await ctx.service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: 'adm_1',
    });

    await ctx.auditContext.run(async () => {
      await ctx.service.revoke({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
      assert.equal(ctx.auditContext.current()?.entityId, 'adm_1');
    });
  });
});

describe('AdminsService grant/revoke — idempotent, so the diff reports what actually moved', () => {
  it('a first grant reports the level going from null to the grant', async () => {
    const ctx = build();
    await withFeature(ctx);

    await ctx.auditContext.run(async () => {
      await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: { from: null, to: PERMISSION_LEVELS.WRITE },
      });
    });
  });

  /**
   * changeGrant filters the admin out of adminIds and re-adds them, so granting twice leaves one
   * entry. A row claiming a grant was made when the admin already held it would be a false record.
   */
  it('re-granting a permission already held changes nothing, and logs nothing', async () => {
    const ctx = build();
    await withFeature(ctx);
    await ctx.service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: 'adm_1',
    });

    await ctx.auditContext.run(async () => {
      await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
      assert.equal(ctx.auditContext.current()?.changed, null);
    });
  });

  it('revoking a permission never held changes nothing, and logs nothing', async () => {
    const ctx = build();
    await withFeature(ctx);

    await ctx.auditContext.run(async () => {
      await ctx.service.revoke({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
      assert.equal(ctx.auditContext.current()?.changed, null);
    });
  });

  it('a real revoke reports the level going away', async () => {
    const ctx = build();
    await withFeature(ctx);
    await ctx.service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: 'adm_1',
    });

    await ctx.auditContext.run(async () => {
      await ctx.service.revoke({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.READ,
        adminId: 'adm_1',
      });
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: { from: PERMISSION_LEVELS.READ, to: null },
      });
    });
  });
});

describe('AdminsService.update — the diff an admin edit contributes', () => {
  it('reports a promotion, driven through the live service', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', isSuperAdmin: false })]);

    await ctx.auditContext.run(async () => {
      await ctx.service.update('adm_1', { isSuperAdmin: true });
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        isSuperAdmin: { from: false, to: true },
      });
    });
  });

  it('reports nothing for a save that changed nothing', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', fullName: 'R Kumar' })]);

    await ctx.auditContext.run(async () => {
      await ctx.service.update('adm_1', { fullName: 'R Kumar' });
      assert.equal(ctx.auditContext.current()?.changed, null);
    });
  });
});

describe('AdminsService.setActive — the isActive diff', () => {
  it('reports the toggle in both directions', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    const actorId = 'adm_actor';

    await ctx.auditContext.run(async () => {
      await ctx.service.setActive('adm_1', false, actorId);
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        isActive: { from: true, to: false },
      });
    });

    await ctx.auditContext.run(async () => {
      await ctx.service.setActive('adm_1', true, actorId);
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        isActive: { from: false, to: true },
      });
    });
  });
});

describe('AdminsService.setActive — driven live, so a toggle that moved nothing says nothing', () => {
  it('reports a deactivation', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', isActive: true })]);

    await ctx.auditContext.run(async () => {
      await ctx.service.setActive('adm_1', false, 'adm_super');

      assert.deepEqual(ctx.auditContext.current()?.changed, {
        isActive: { from: true, to: false },
      });
    });
  });

  /**
   * The failure this prevents: re-activating an already-active admin filed
   * `{ isActive: { from: true, to: true } }`. FEATURE_PERMISSION and ADMIN are the rows a security
   * question is answered from, so one asserting a change that did not happen is the worst place
   * for this noise to land.
   */
  it('reports nothing when the toggle did not move, in either direction', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', isActive: true })]);

    await ctx.auditContext.run(async () => {
      await ctx.service.setActive('adm_1', true, 'adm_super');
      assert.equal(ctx.auditContext.current()?.changed, null);
    });

    const off = build([makeAdminRow({ id: 'adm_2', isActive: false })]);
    await off.auditContext.run(async () => {
      await off.service.setActive('adm_2', false, 'adm_super');
      assert.equal(off.auditContext.current()?.changed, null);
    });
  });
});
