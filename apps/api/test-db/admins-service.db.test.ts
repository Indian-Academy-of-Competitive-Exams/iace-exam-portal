import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { AdminsService } from '../src/admins';
import { AuditContext } from '../src/audit';
import { makeAdmin, resetDatabase, testPrisma, uid } from './support/database';

const ACTOR = 'adm_actor';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const auditContext = new AuditContext();
  return { auditContext, service: new AdminsService(prisma, auditContext) };
}

const grantsOf = (adminId: string) =>
  prisma.adminFeaturePermission.findMany({ where: { adminId } });

describe('AdminsService — features', () => {
  /** The list is FEATURE_KEYS, not a table: every checked key is grantable, and no other key is. */
  it('lists every code-owned key, with both levels empty before anything is granted', async () => {
    const { service } = build();

    const features = await service.listFeatures();

    assert.deepEqual(
      features.map((feature) => feature.key).sort(),
      Object.values(FEATURE_KEYS).sort(),
    );
    for (const feature of features) {
      assert.deepEqual(feature.grants.READ, []);
      assert.deepEqual(feature.grants.WRITE, []);
    }
  });
});

describe('AdminsService — grants', () => {
  it('grants a level and reads it back as the admin permission map', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);

    await service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: admin.id,
    });

    assert.deepEqual(await service.permissionsFor(admin.id), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  it('is idempotent — granting twice leaves one entry, so one revoke undoes it', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    const grant = {
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: admin.id,
    };

    await service.grant(grant);
    const twice = await service.grant(grant);
    assert.deepEqual(twice.grants.READ, [admin.id]);

    const revoked = await service.revoke(grant);
    assert.deepEqual(revoked.grants.READ, []);
    assert.deepEqual(await service.permissionsFor(admin.id), {});
  });

  /** Should not happen through the UI, but if it does the answer must be the more permissive one. */
  it('resolves a doubled grant to WRITE rather than to whichever row came back first', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    for (const level of [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE]) {
      await service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level,
        adminId: admin.id,
      });
    }

    assert.deepEqual(await service.permissionsFor(admin.id), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** Every code-owned key is grantable without anybody registering it first. */
  it('grants a key nothing has been granted on before', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);

    const feature = await service.grant({
      featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: admin.id,
    });

    assert.deepEqual(feature.grants.READ, [admin.id]);
  });

  /** The guard reads this map, so a key left by an older build must be dropped, never carried. */
  it('drops a stored key the code no longer defines', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    await prisma.adminFeaturePermission.create({
      data: {
        adminId: admin.id,
        featureKey: 'REPORTING_DASHBOARD',
        level: PERMISSION_LEVELS.WRITE,
      },
    });

    assert.deepEqual(await service.permissionsFor(admin.id), {});
  });

  /** Miss page or pageSize and the interceptor wraps the whole object, which the client refuses. */
  it('returns the full paginated shape the interceptor unpacks', async () => {
    const { service } = build();
    await makeAdmin(prisma);

    const listed = await service.list({
      page: 1,
      pageSize: 20,
      q: undefined,
      activeOnly: undefined,
    });

    assert.deepEqual(Object.keys(listed).sort(), ['items', 'page', 'pageSize', 'total']);
    assert.equal(listed.page, 1);
    assert.equal(listed.pageSize, 20);
  });
});

describe('AdminsService — admins', () => {
  it('refuses a duplicate email with a field error', async () => {
    const { service } = build();
    await makeAdmin(prisma, { email: 'taken@iace.co.in' });

    await assert.rejects(
      () => service.create({ email: 'taken@iace.co.in', isSuperAdmin: false }, ACTOR),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'CONFLICT');
        assert.ok(error.fieldErrors?.email);
        return true;
      },
    );
  });

  it('records who created an admin from the token, not the body', async () => {
    const { service } = build();

    const created = await service.create({ email: 'new@iace.co.in', isSuperAdmin: true }, ACTOR);

    assert.equal(created.isSuperAdmin, true);
    assert.deepEqual(created.permissions, {});
    const row = await prisma.admin.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.createdById, ACTOR);
  });
});

describe('AdminsService — setActive', () => {
  /** THE failure this feature prevents: a surviving grant row would come back with the account. */
  it('prunes every grant, so reactivating never silently restores access', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    for (const featureKey of [FEATURE_KEYS.STUDENT_MANAGEMENT, FEATURE_KEYS.TEST_MANAGEMENT]) {
      await service.grant({ featureKey, level: PERMISSION_LEVELS.WRITE, adminId: admin.id });
    }

    await service.setActive(admin.id, false, ACTOR);

    assert.deepEqual(await service.permissionsFor(admin.id), {});
    assert.deepEqual(await grantsOf(admin.id), [], 'no grant row may survive the deactivation');
  });

  /** Deactivation is not deletion: the account still exists, signs in, and lists as Deactivated. */
  it('switches the account off WITHOUT removing it', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);

    await service.setActive(admin.id, false, ACTOR);

    const row = await prisma.admin.findUnique({ where: { id: admin.id } });
    assert.ok(row, 'the row must survive — other records reference the id');
    assert.equal(row.isActive, false);
  });

  it('leaves a deactivated admin visible in the list', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    await service.setActive(admin.id, false, ACTOR);

    const listed = await service.list({
      page: 1,
      pageSize: 20,
      q: undefined,
      activeOnly: undefined,
    });

    assert.deepEqual(
      listed.items.map((row) => [row.id, row.isActive]),
      [[admin.id, false]],
    );
  });

  it('leaves other admins’ grants alone', async () => {
    const { service } = build();
    const [first, second] = [await makeAdmin(prisma), await makeAdmin(prisma)];
    for (const adminId of [first.id, second.id]) {
      await service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.READ,
        adminId,
      });
    }

    await service.setActive(first.id, false, ACTOR);

    assert.deepEqual(await service.permissionsFor(second.id), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });
  });

  it('refuses to deactivate the caller — that lockout needs database access to undo', async () => {
    const { service } = build();
    const actor = await makeAdmin(prisma);

    await assert.rejects(
      () => service.setActive(actor.id, false, actor.id),
      (error: unknown) => AppException.is(error) && error.code === 'CONFLICT',
    );
  });

  it('refuses an id that is not an admin at all', async () => {
    const { service } = build();

    await assert.rejects(
      () => service.setActive(uid('admin'), false, ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'NOT_FOUND',
    );
  });

  it('switches a deactivated admin back on', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma, { isActive: false });

    const restored = await service.setActive(admin.id, true, ACTOR);

    assert.equal(restored.isActive, true);
    const row = await prisma.admin.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(row.isActive, true);
  });

  /** The rule that keeps deactivation a removal rather than a pause. */
  it('does NOT hand back the grants deactivation took away', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    await service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: admin.id,
    });

    await service.setActive(admin.id, false, ACTOR);
    const restored = await service.setActive(admin.id, true, ACTOR);

    assert.deepEqual(restored.permissions, {}, 'reactivation must not restore grants');
    assert.deepEqual(await service.permissionsFor(admin.id), {});
  });

  /** Read back rather than assumed empty: a super admin may prepare access before switching them on. */
  it('shows a grant made while the account was switched off', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma, { isActive: false });
    await prisma.adminFeaturePermission.create({
      data: {
        adminId: admin.id,
        featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
        level: PERMISSION_LEVELS.READ,
      },
    });

    const restored = await service.setActive(admin.id, true, ACTOR);

    assert.deepEqual(restored.permissions, {
      [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });
  });
});

/** Driven inside a live AuditContext, the way the interceptor reads it: setEntityId left out would show. */
describe('AdminsService grant/revoke — the entity the row is filed against', () => {
  /** Neither route has an `:id` param, so the interceptor's fallback would file the row somewhere else. */
  it('grant sets the entity id to the admin, not the feature the call returns', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);

    const feature = await auditContext.run(async () => {
      const result = await service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: admin.id,
      });
      assert.equal(auditContext.current()?.entityId, admin.id);
      return result;
    });

    assert.equal(feature.key, FEATURE_KEYS.STUDENT_MANAGEMENT);
  });

  it('revoke sets the entity id to the admin too', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);
    const grant = {
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: admin.id,
    };
    await service.grant(grant);

    await auditContext.run(async () => {
      await service.revoke(grant);
      assert.equal(auditContext.current()?.entityId, admin.id);
    });
  });
});

describe('AdminsService grant/revoke — idempotent, so the diff reports what actually moved', () => {
  it('a first grant reports the level going from null to the grant', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);

    await auditContext.run(async () => {
      await service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: admin.id,
      });
      assert.deepEqual(auditContext.current()?.changed, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: { from: null, to: PERMISSION_LEVELS.WRITE },
      });
    });
  });

  /** A row claiming a grant was made when the admin already held it would be a false record. */
  it('re-granting a permission already held changes nothing, and logs nothing', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);
    const grant = {
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: admin.id,
    };
    await service.grant(grant);

    await auditContext.run(async () => {
      await service.grant(grant);
      assert.equal(auditContext.current()?.changed, null);
    });
  });

  it('revoking a permission never held changes nothing, and logs nothing', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);

    await auditContext.run(async () => {
      await service.revoke({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.WRITE,
        adminId: admin.id,
      });
      assert.equal(auditContext.current()?.changed, null);
    });
  });

  it('a real revoke reports the level going away', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);
    const grant = {
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: admin.id,
    };
    await service.grant(grant);

    await auditContext.run(async () => {
      await service.revoke(grant);
      assert.deepEqual(auditContext.current()?.changed, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: { from: PERMISSION_LEVELS.READ, to: null },
      });
    });
  });
});

describe('AdminsService.update — the diff an admin edit contributes', () => {
  it('reports a promotion, driven through the live service', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma, { isSuperAdmin: false });

    await auditContext.run(async () => {
      await service.update(admin.id, { isSuperAdmin: true });
      assert.deepEqual(auditContext.current()?.changed, {
        isSuperAdmin: { from: false, to: true },
      });
    });
  });

  it('reports nothing for a save that changed nothing', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma, { fullName: 'R Kumar' });

    await auditContext.run(async () => {
      await service.update(admin.id, { fullName: 'R Kumar' });
      assert.equal(auditContext.current()?.changed, null);
    });
  });
});

describe('AdminsService.setActive — the isActive diff', () => {
  it('reports the toggle in both directions', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);

    await auditContext.run(async () => {
      await service.setActive(admin.id, false, ACTOR);
      assert.deepEqual(auditContext.current()?.changed, { isActive: { from: true, to: false } });
    });

    await auditContext.run(async () => {
      await service.setActive(admin.id, true, ACTOR);
      assert.deepEqual(auditContext.current()?.changed, { isActive: { from: false, to: true } });
    });
  });

  /** Re-activating an active admin once filed { from: true, to: true } — noise in a security record. */
  it('reports nothing when the toggle did not move, in either direction', async () => {
    const { service, auditContext } = build();
    const on = await makeAdmin(prisma, { isActive: true });
    const off = await makeAdmin(prisma, { isActive: false });

    await auditContext.run(async () => {
      await service.setActive(on.id, true, ACTOR);
      assert.equal(auditContext.current()?.changed, null);
    });

    await auditContext.run(async () => {
      await service.setActive(off.id, false, ACTOR);
      assert.equal(auditContext.current()?.changed, null);
    });
  });
});
