import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, FEATURE_KEYS, PERMISSION_LEVELS, type FeatureKey } from '@iace/contracts';
import { AdminsService } from '../src/admins';
import { FakeAdminsPrisma, makeAdminRow } from './support/fakes';

function build(admins = [makeAdminRow()]) {
  const prisma = new FakeAdminsPrisma(admins);
  return { prisma, service: new AdminsService(prisma.asService()) };
}

const ACTOR = 'adm_actor';

async function withFeature(
  ctx: ReturnType<typeof build>,
  key: FeatureKey = FEATURE_KEYS.STUDENT_MANAGEMENT,
): Promise<void> {
  await ctx.service.createFeature({ key });
}

describe('AdminsService — features', () => {
  it('creates BOTH permission rows with the feature', async () => {
    // The failure this prevents: a feature with only a READ row is one whose
    // WRITE grants can never be made — grant() updates an existing row, so it
    // would have nothing to update and would fail at the moment somebody tried.
    const ctx = build();

    const feature = await ctx.service.createFeature({ key: FEATURE_KEYS.TEST_MANAGEMENT });

    assert.deepEqual(Object.keys(feature.grants).sort(), ['READ', 'WRITE']);
    assert.deepEqual(feature.grants.READ, []);
    assert.deepEqual(feature.grants.WRITE, []);
    assert.equal(ctx.prisma.permissions.length, 2);
  });

  it('refuses a second feature with the same key', async () => {
    const ctx = build();
    await withFeature(ctx);

    await assert.rejects(
      () => withFeature(ctx),
      (error: unknown) => AppException.is(error) && error.code === 'CONFLICT',
    );
  });
});

describe('AdminsService — grants', () => {
  it('grants a level and reads it back as the admin permission map', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    await withFeature(ctx);

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
    await withFeature(ctx);
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
    await withFeature(ctx);
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

  it('refuses a grant on a feature nobody has registered', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    await assert.rejects(
      () =>
        ctx.service.grant({
          featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
          level: PERMISSION_LEVELS.READ,
          adminId: 'adm_1',
        }),
      (error: unknown) => AppException.is(error) && error.code === 'NOT_FOUND',
    );
  });

  it('carries a key the code does not know about', async () => {
    // The key set is OPEN: a super admin registers sectors as the product
    // grows, and one no controller checks YET must still round-trip. Dropping
    // it would silently discard a grant somebody deliberately made — and
    // discard it again on every refresh, so it would never stick.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    await ctx.service.createFeature({ key: 'REPORTING_DASHBOARD' });
    await ctx.service.grant({
      featureKey: 'REPORTING_DASHBOARD',
      level: PERMISSION_LEVELS.WRITE,
      adminId: 'adm_1',
    });

    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {
      REPORTING_DASHBOARD: PERMISSION_LEVELS.WRITE,
    });
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
      () => ctx.service.create({ email: 'taken@iace.co.in', isSuperAdmin: false }, ACTOR),
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
      { email: 'new@iace.co.in', isSuperAdmin: true },
      ACTOR,
    );

    assert.equal(created.isSuperAdmin, true);
    assert.deepEqual(created.permissions, {});
    assert.equal(ctx.prisma.admins.find((a) => a.id === created.id)?.createdById, ACTOR);
  });
});

describe('AdminsService — deactivate', () => {
  it('prunes every grant, so reactivating never silently restores access', async () => {
    // THE failure this feature exists to prevent. adminIds is a denormalized
    // array with no foreign key, so nothing else would ever remove the id: the
    // grants would sit there and come back the moment the account did.
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);
    await withFeature(ctx);
    await withFeature(ctx, FEATURE_KEYS.TEST_MANAGEMENT);
    for (const featureKey of [FEATURE_KEYS.STUDENT_MANAGEMENT, FEATURE_KEYS.TEST_MANAGEMENT]) {
      await ctx.service.grant({
        featureKey,
        level: PERMISSION_LEVELS.WRITE,
        adminId: 'adm_1',
      });
    }

    await ctx.service.deactivate('adm_1', ACTOR);

    assert.deepEqual(await ctx.service.permissionsFor('adm_1'), {});
    assert.deepEqual(
      ctx.prisma.permissions.flatMap((p) => p.adminIds),
      [],
      'no permission row may still hold the deactivated id',
    );
  });

  it('soft-deletes rather than removing the row', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' })]);

    await ctx.service.deactivate('adm_1', ACTOR);

    const row = ctx.prisma.admins.find((a) => a.id === 'adm_1');
    assert.ok(row, 'the row must survive — other records reference the id');
    assert.equal(row.isActive, false);
    assert.ok(row.deletedAt instanceof Date);
  });

  it('leaves other admins’ grants alone', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1' }), makeAdminRow({ id: 'adm_2' })]);
    await withFeature(ctx);
    for (const adminId of ['adm_1', 'adm_2']) {
      await ctx.service.grant({
        featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
        level: PERMISSION_LEVELS.READ,
        adminId,
      });
    }

    await ctx.service.deactivate('adm_1', ACTOR);

    assert.deepEqual(await ctx.service.permissionsFor('adm_2'), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });
  });

  it('refuses to deactivate the caller — that lockout needs database access to undo', async () => {
    const ctx = build([makeAdminRow({ id: ACTOR })]);

    await assert.rejects(
      () => ctx.service.deactivate(ACTOR, ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'CONFLICT',
    );
  });

  it('refuses an admin who is already gone', async () => {
    const ctx = build([makeAdminRow({ id: 'adm_1', deletedAt: new Date() })]);

    await assert.rejects(
      () => ctx.service.deactivate('adm_1', ACTOR),
      (error: unknown) => AppException.is(error) && error.code === 'NOT_FOUND',
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
