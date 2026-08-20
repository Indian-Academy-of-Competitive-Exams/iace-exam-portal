import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { AdminsService } from '../src/admins';
import { AuditContext } from '../src/audit';
import { type FakeBranch, FakeAdminsPrisma, makeAdminRow, makeBranch } from './support/fakes';

function build(admins = [makeAdminRow()], branches: FakeBranch[] = []) {
  const prisma = new FakeAdminsPrisma(admins, branches);
  return { prisma, service: new AdminsService(prisma.asService(), new AuditContext()) };
}

const ACTOR = 'adm_actor';

describe('AdminsService — features', () => {
  it('lists every code-owned key, with both levels empty before anything is granted', async () => {
    // The list is FEATURE_KEYS, not a table: a key nothing in the code checks cannot be granted,
    // and a key the code does check is always grantable without anybody registering it first.
    const ctx = build();

    const features = await ctx.service.listFeatures();

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
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    await ctx.service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: 'adm_1',
    });

    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  it('is idempotent — granting twice leaves one entry, so one revoke undoes it', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    const grant = {
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: 'adm_1',
    };

    await ctx.service.grant(grant);
    const twice = await ctx.service.grant(grant);
    assert.deepEqual(twice.grants.READ, ['adm_1']);

    const revoked = await ctx.service.revoke(grant);
    assert.deepEqual(revoked.grants.READ, []);
    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {});
  });

  it('resolves a doubled grant to WRITE rather than to whichever row came back first', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    for (const level of [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE]) {
      await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level,
        adminId: 'adm_1',
      });
    }

    // Should not happen through the UI, but if it does the answer must be
    // deterministic and it must be the more permissive one.
    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** Every code-owned key is grantable without anybody registering it first. */
  it('grants a key nothing has been granted on before', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    const feature = await ctx.service.grant({
      featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
      adminId: 'adm_1',
    });

    assert.deepEqual(feature.grants.READ, ['adm_1']);
  });

  it('drops a stored key the code no longer defines', async () => {
    // The guard reads this map. A key left behind by an older build must not resolve to access
    // nothing in the code checks — it is dropped rather than carried.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    ctx.prisma.grants.push({
      adminId: 'adm_1',
      featureKey: 'REPORTING_DASHBOARD' as never,
      level: PERMISSION_LEVELS.WRITE,
    });

    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {});
  });

  it('returns the full paginated shape the interceptor unpacks', async () => {
    // Miss page or pageSize and isPaginated() says false, the whole object is
    // wrapped as `data`, and the client fails with "unexpected response shape".
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    const listed = await ctx.service.list({
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
    const ctx = build([makeAdminRow({ email: 'taken@iace.co.in' })]);

    await assert.rejects(
      () =>
        ctx.service.create(
          { email: 'taken@iace.co.in', isSuperAdmin: false, allBranches: false },
          ACTOR,
        ),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'CONFLICT');
        assert.ok(error.fieldErrors?.email);
        return true;
      },
    );
  });

  it('records who created an admin from the token, not the body', async () => {
    const ctx = build([]);

    const created = await ctx.service.create(
      { email: 'new@iace.co.in', isSuperAdmin: true, allBranches: false },
      ACTOR,
    );

    assert.equal(created.isSuperAdmin, true);
    assert.deepEqual(created.permissions, {});
    assert.equal(ctx.prisma.admins.find((a) => a.id === created.id)?.createdById, ACTOR);
  });
});

describe('AdminsService — which branches an admin reaches', () => {
  /**
   * THE rule: "every branch" is a column, never an inference from an empty list. An admin who has
   * been given no branch yet reaches NONE, and reading that as "all of them" would hand a new
   * account the whole institute on the day it was created.
   */
  it('creates an admin with no branch and no reach, not with every branch', async () => {
    const ctx = build();

    const created = await ctx.service.create(
      { email: 'new@iace.co.in', isSuperAdmin: false, allBranches: false },
      ACTOR,
    );

    assert.equal(created.allBranches, false);
    assert.deepEqual(created.branchIds, []);
  });

  it('says all branches out loud when that is what was asked for', async () => {
    const ctx = build();

    const created = await ctx.service.create(
      { email: 'wide@iace.co.in', isSuperAdmin: false, allBranches: true },
      ACTOR,
    );

    assert.equal(created.allBranches, true);
  });

  it('replaces the branch set wholesale rather than adding to it', async () => {
    const ctx = build(
      [makeAdminRow({ id: 'adm_1', branches: [{ branchId: 'br_1' }] })],
      [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'RTC X ROADS' })],
    );

    const updated = await ctx.service.update('adm_1', { branchIds: ['br_2'] });

    assert.deepEqual(updated.branchIds, ['br_2']);
  });

  it('takes every branch away when the list is emptied', async () => {
    const ctx = build(
      [makeAdminRow({ id: 'adm_1', branches: [{ branchId: 'br_1' }] })],
      [makeBranch({ id: 'br_1' })],
    );

    const updated = await ctx.service.update('adm_1', { branchIds: [] });

    assert.deepEqual(updated.branchIds, []);
    assert.equal(updated.allBranches, false, 'an empty list is not a way to say "all of them"');
  });

  it('refuses a branch that no longer exists, against the field the form owns', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    await assert.rejects(
      () => ctx.service.update('adm_1', { branchIds: ['br_gone'] }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.branchIds);
        return true;
      },
    );
  });
});

describe('AdminsService — setActive', () => {
  it('prunes every grant, so reactivating never silently restores access', async () => {
    // THE failure this feature exists to prevent: nothing else removes a grant row, so it would
    // sit there and come back the moment the account did.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    for (const featureKey of [FEATURE_KEYS.STUDENT_MANAGEMENT, FEATURE_KEYS.TEST_MANAGEMENT]) {
      await ctx.service.grant({
        featureKey,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
    }

    await ctx.service.setActive('adm_1', false, ACTOR);

    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {});
    assert.deepEqual(
      ctx.prisma.grants.filter((grant) => grant.adminId === 'adm_1'),
      [],
      'no grant row may survive the deactivation',
    );
  });

  it('switches the account off WITHOUT removing it', async () => {
    // Deactivation is not deletion. The account still exists, still signs in (so it can be told what
    // happened), and still appears in the admins list marked Deactivated.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    await ctx.service.setActive('adm_1', false, ACTOR);

    const row = ctx.prisma.admins.find((a) => a.id === 'adm_1');
    assert.ok(row, 'the row must survive — other records reference the id');
    assert.equal(row.isActive, false);
  });

  it('leaves a deactivated admin visible in the list', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    await ctx.service.setActive('adm_1', false, ACTOR);

    const listed = await ctx.service.list({
      page: 1,
      pageSize: 20,
      q: undefined,
      activeOnly: undefined,
    });

    assert.deepEqual(
      listed.items.map((a) => [a.id, a.isActive]),
      [['adm_1', false]],
    );
  });

  it('leaves other admins’ grants alone', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' }), makeAdminRow({ id: 'adm_2' })]);
    for (const adminId of ['adm_1', 'adm_2']) {
      await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.READ,
        adminId,
      });
    }

    await ctx.service.setActive('adm_1', false, ACTOR);

    assert.deepEqual(await ctx.service.permissionsFor('adm_2'), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });
  });

  it('refuses to deactivate the caller — that lockout needs database access to undo', async () => {
    const ctx = build([makeAdminRow({ id: ACTOR })]);

    await assert.rejects(
      () => ctx.service.setActive(ACTOR, false, ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'CONFLICT',
    );
  });

  it('refuses an id that is not an admin at all', async () => {
    const ctx = build([]);

    await assert.rejects(
      () => ctx.service.setActive('nobody', false, ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'NOT_FOUND',
    );
  });

  it('switches a deactivated admin back on', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', isActive: false })]);

    const restored = await ctx.service.setActive('adm_1', true, ACTOR);

    assert.equal(restored.isActive, true);
    assert.equal(ctx.prisma.admins.find((a) => a.id === 'adm_1')?.isActive, true);
  });

  it('does NOT hand back the grants deactivation took away', async () => {
    // The rule that keeps deactivation a removal rather than a pause.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    await ctx.service.grant({
      featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
      level: PERMISSION_LEVELS.WRITE,
      adminId: 'adm_1',
    });

    await ctx.service.setActive('adm_1', false, ACTOR);
    const restored = await ctx.service.setActive('adm_1', true, ACTOR);

    assert.deepEqual(restored.permissions, {}, 'reactivation must not restore grants');
    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {});
  });

  it('shows a grant made while the account was switched off', async () => {
    // The map is read back rather than assumed empty — a super admin may have
    // prepared their access before switching them on again.
    const ctx = build([makeAdminRow({ id: 'adm_1', isActive: false })]);
    ctx.prisma.grants.push({
      adminId: 'adm_1',
      featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
    });

    const restored = await ctx.service.setActive('adm_1', true, ACTOR);

    assert.deepEqual(restored.permissions, {
      [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });
  });

  it('still refuses to switch off the caller, in either direction of the guard', async () => {
    const ctx = build([makeAdminRow({ id: ACTOR })]);

    await assert.rejects(
      () => ctx.service.setActive(ACTOR, false, ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'CONFLICT',
    );
  });
});

describe('AdminsService — student sync', () => {
  it('is a finished trigger around an unfinished body, and changes nothing', async () => {
    const ctx = build();

    const result = await ctx.service.triggerStudentSync();

    assert.equal(result.status, 'NOT_IMPLEMENTED');
    assert.equal(result.syncedCount, null);
    assert.ok(Date.parse(result.startedAt) > 0, 'startedAt must be a real timestamp');
  });
});
