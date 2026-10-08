import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { type Prisma } from '@prisma/client';
import {
  ADMIN_ROLES,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  can,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { AdminsService } from '../src/admins';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FakeEventBus } from '../test/support/fakes';
import { makeAdmin, resetDatabase, testPrisma, uid } from './support/database';

const ACTOR = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(client: PrismaService = prisma) {
  const auditContext = new AuditContext();
  const events = new FakeEventBus();
  return {
    auditContext,
    events,
    service: new AdminsService(client, auditContext, events.asService()),
  };
}

const grantsOf = (adminId: string) =>
  prisma.adminFeaturePermission.findMany({ where: { adminId } });

const grant = (adminId: string, featureKey: FeatureKey, level: PermissionLevel) =>
  prisma.adminFeaturePermission.create({ data: { adminId, featureKey, level } });

const notFound = (e: unknown) => AppException.is(e) && e.code === ErrorCodes.NOT_FOUND;

/** Returns once some statement waits on a row lock, or once `work` settles without ever having to. */
async function blockedOrSettled(work: Promise<unknown>): Promise<void> {
  let settled = false;
  void work.finally(() => (settled = true));
  for (let tries = 0; tries < 200 && !settled; tries += 1) {
    const [waiting] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE "wait_event_type" = 'Lock' AND "datname" = current_database()`;
    if ((waiting?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The second grant written inside the save throws, the way a dropped connection would. */
function failingOnSecondWrite(): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) => {
          let writes = 0;
          const table = new Proxy(tx.adminFeaturePermission, {
            get(delegate, method: string | symbol) {
              if (method !== 'upsert') return Reflect.get(delegate, method) as unknown;
              return (args: Prisma.AdminFeaturePermissionUpsertArgs) => {
                writes += 1;
                if (writes === 2) return Promise.reject(new Error('connection dropped'));
                return delegate.upsert(args);
              };
            },
          });
          return work(
            new Proxy(tx, {
              get: (inner, member: string | symbol) =>
                member === 'adminFeaturePermission'
                  ? table
                  : (Reflect.get(inner, member) as unknown),
            }),
          );
        });
    },
  });
}

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

describe('AdminsService — permissions, saved in one request', () => {
  it('saves a level and reads it back as the admin permission map', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);

    const saved = await service.setPermissions(admin.id, {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });

    assert.deepEqual(saved.permissions, {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  it('grants, changes and removes several features in the one save, leaving the rest alone', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ);
    await grant(admin.id, FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
    await grant(admin.id, FEATURE_KEYS.DATA_EXPORT, PERMISSION_LEVELS.READ);

    await service.setPermissions(admin.id, {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
      [FEATURE_KEYS.TEST_MANAGEMENT]: null,
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
    });

    assert.deepEqual(await service.permissionsFor(admin.id), {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
      [FEATURE_KEYS.DATA_EXPORT]: PERMISSION_LEVELS.READ,
    });
    assert.equal((await grantsOf(admin.id)).length, 3, 'one row per feature held');
  });

  /** The failure this prevents: a save that dies partway leaving some features granted and some not. */
  it('fails whole: a save that breaks partway leaves every feature as it was', async () => {
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
    const { service } = build(failingOnSecondWrite());

    await assert.rejects(
      service.setPermissions(admin.id, {
        [FEATURE_KEYS.TEST_MANAGEMENT]: null,
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
      }),
      /connection dropped/,
    );

    assert.deepEqual(await build().service.permissionsFor(admin.id), {
      [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** Deactivation prunes every grant; a save must not hand them back. */
  it('refuses a deactivated admin, and one who does not exist', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma, { isActive: false });
    const students = { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE };

    await assert.rejects(service.setPermissions(admin.id, students), notFound);
    await assert.rejects(service.setPermissions(randomUUID(), students), notFound);
    assert.deepEqual(await grantsOf(admin.id), []);
  });

  /** The failure this prevents: a deactivation committing mid-save, leaving a switched-off admin holding grants. */
  it('waits out a deactivation in flight, then refuses rather than writing grants back', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let deactivated = (): void => undefined;
    const locked = new Promise<void>((resolve) => (deactivated = resolve));
    const deactivating = prisma.$transaction(
      async (tx) => {
        await tx.admin.update({ where: { id: admin.id }, data: { isActive: false } });
        await tx.adminFeaturePermission.deleteMany({ where: { adminId: admin.id } });
        deactivated();
        await held;
      },
      { timeout: 10_000 },
    );
    await locked;

    const saving = service
      .setPermissions(admin.id, { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE })
      .then(
        () => null,
        (error: unknown) => error,
      );
    await blockedOrSettled(saving);
    release();
    await deactivating;

    assert.ok(notFound(await saving), 'the save must see the deactivation it waited for');
    assert.deepEqual(await grantsOf(admin.id), []);
  });

  /** One level per feature is the table's rule, so "WRITE wins" is never a question anybody asks. */
  it('holds one level per feature — a second row for the same feature is refused', async () => {
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);

    await assert.rejects(
      grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ),
      (e: unknown) => (e as { code?: string }).code === 'P2002',
    );
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
      () => service.create({ email: 'taken@iace.co.in', role: ADMIN_ROLES.ADMIN }, ACTOR),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'CONFLICT');
        assert.ok(error.fieldErrors?.email);
        return true;
      },
    );
  });

  /** The role is the whole choice: it carries the bypass and the opening grants together. */
  it('opens a typist with their role’s permissions, ready to work', async () => {
    const { service } = build();

    const created = await service.create(
      { email: 'typist@iace.co.in', role: ADMIN_ROLES.TYPIST },
      ACTOR,
    );

    assert.equal(created.isSuperAdmin, false);
    assert.deepEqual(created.permissions, {
      [FEATURE_KEYS.QUESTION_AUTHORING]: PERMISSION_LEVELS.WRITE,
    });
    const stored = await prisma.adminFeaturePermission.findMany({
      where: { adminId: created.id },
      select: { featureKey: true, level: true },
    });
    assert.deepEqual(stored, [
      { featureKey: FEATURE_KEYS.QUESTION_AUTHORING, level: PERMISSION_LEVELS.WRITE },
    ]);
  });

  /** The contradiction this removes: a super admin with the tick left off was not one. */
  it('makes a super admin of the role alone, with nothing ticked to say so', async () => {
    const { service } = build();

    const created = await service.create(
      { email: 'boss@iace.co.in', role: ADMIN_ROLES.SUPER_ADMIN },
      ACTOR,
    );

    assert.equal(created.isSuperAdmin, true);
    // Nothing to grant: a super admin is past every check the grants are read at.
    assert.deepEqual(created.permissions, {});
    assert.equal(await prisma.adminFeaturePermission.count({ where: { adminId: created.id } }), 0);
  });

  it('leaves the bypass off for every other role', async () => {
    const { service } = build();

    const created = await service.create(
      { email: 'reader@iace.co.in', role: ADMIN_ROLES.PROOFREADER },
      ACTOR,
    );

    assert.equal(created.isSuperAdmin, false);
    assert.equal(created.permissions[FEATURE_KEYS.QUESTION_PROOFREAD], PERMISSION_LEVELS.WRITE);
  });

  it('records who created an admin from the token, not the body', async () => {
    const { service } = build();

    const created = await service.create(
      { email: 'new@iace.co.in', role: ADMIN_ROLES.SUPER_ADMIN },
      ACTOR,
    );

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
      await grant(admin.id, featureKey, PERMISSION_LEVELS.WRITE);
    }

    await service.setActive(admin.id, false, ACTOR);

    assert.deepEqual(await service.permissionsFor(admin.id), {});
    assert.deepEqual(await grantsOf(admin.id), [], 'no grant row may survive the deactivation');
  });

  /** The failure this prevents: a switched-off admin working on until their access token expires. */
  it('announces the switch-off, so auth can revoke the sessions now', async () => {
    const { service, events } = build();
    const admin = await makeAdmin(prisma);

    await service.setActive(admin.id, false, ACTOR);

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ADMIN_DEACTIVATED).map((payload) => payload.adminId),
      [admin.id],
    );

    events.forget();
    await service.setActive(admin.id, true, ACTOR);
    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ADMIN_DEACTIVATED),
      [],
      'switching ON revokes nothing',
    );
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
      await grant(adminId, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ);
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
      () => service.setActive(uid(), false, ACTOR),
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
    await grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);

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

describe('AdminsService — somebody is always left who can manage admins', () => {
  const conflict = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;
  const superAdmin = () => makeAdmin(prisma, { isSuperAdmin: true });
  const activeSuperAdmins = () =>
    prisma.admin.count({ where: { isSuperAdmin: true, isActive: true } });

  /** THE failure this prevents: nobody left who can reach the Admins screen, undone only in SQL. */
  it('refuses to demote or deactivate the only active super admin', async () => {
    const { service } = build();
    const only = await superAdmin();
    await makeAdmin(prisma, { isSuperAdmin: true, isActive: false });

    await assert.rejects(() => service.update(only.id, { role: ADMIN_ROLES.ADMIN }), conflict);
    await assert.rejects(() => service.setActive(only.id, false, ACTOR), conflict);

    const row = await prisma.admin.findUniqueOrThrow({ where: { id: only.id } });
    assert.deepEqual([row.isSuperAdmin, row.isActive], [true, true]);
  });

  it('lets one of several go, by either route, and a rename of the last one through', async () => {
    const { service } = build();
    const [first, second, third] = [await superAdmin(), await superAdmin(), await superAdmin()];

    await service.update(first.id, { role: ADMIN_ROLES.ADMIN });
    await service.setActive(second.id, false, ACTOR);
    const renamed = await service.update(third.id, { fullName: 'The last one' });

    assert.equal(renamed.fullName, 'The last one');
    assert.equal(await activeSuperAdmins(), 1);
  });

  it('lets one of two through and refuses the other when they deactivate each other at once', async () => {
    const { service } = build();
    const [first, second] = [await superAdmin(), await superAdmin()];

    const outcomes = await Promise.allSettled([
      service.setActive(second.id, false, first.id),
      service.setActive(first.id, false, second.id),
    ]);

    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert.equal(refused.length, 1);
    assert.ok(conflict(refused[0]?.reason));
    assert.equal(await activeSuperAdmins(), 1);
  });

  it('holds when one is demoted while the other is deactivated', async () => {
    const { service } = build();
    const [first, second] = [await superAdmin(), await superAdmin()];

    const outcomes = await Promise.allSettled([
      service.update(first.id, { role: ADMIN_ROLES.ADMIN }),
      service.setActive(second.id, false, first.id),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
    assert.equal(await activeSuperAdmins(), 1);
  });
});

describe('AdminsService.update — a role change re-aligns the grants', () => {
  /** THE failure this prevents: a demotion that left every grant of the role they came from live. */
  it('drops every grant the new role does not carry, and seeds nothing in their place', async () => {
    const { service } = build();
    const admin = await service.create(
      { email: 'wide@iace.co.in', role: ADMIN_ROLES.ADMIN },
      ACTOR,
    );
    assert.ok((await grantsOf(admin.id)).length > 0, 'the ADMIN preset opened grants to narrow');

    const demoted = await service.update(admin.id, { role: ADMIN_ROLES.TYPIST });

    assert.deepEqual(demoted.permissions, {}, 'narrowed, and the TYPIST preset not seeded');
    assert.deepEqual(await grantsOf(admin.id), []);
  });

  it('keeps a grant the new role still carries, at the level it was set to', async () => {
    const { service } = build();
    const admin = await service.create(
      { email: 'moved@iace.co.in', role: ADMIN_ROLES.TYPIST },
      ACTOR,
    );
    await grant(admin.id, FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);

    const moved = await service.update(admin.id, { role: ADMIN_ROLES.PROOFREADER });

    // The PROOFREADER preset holds this key at READ, so WRITE surviving is the set level rather than the preset's.
    assert.deepEqual(moved.permissions, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** identityOf already ignores a super admin's grants, so a promotion leaves them for the demotion to narrow. */
  it('holds a super admin’s grants dormant, and narrows them when the role comes back down', async () => {
    const { service } = build();
    await makeAdmin(prisma, { isSuperAdmin: true });
    const admin = await service.create(
      { email: 'promoted@iace.co.in', role: ADMIN_ROLES.ADMIN },
      ACTOR,
    );
    const opened = await service.permissionsFor(admin.id);

    const promoted = await service.update(admin.id, { role: ADMIN_ROLES.SUPER_ADMIN });

    assert.equal(promoted.isSuperAdmin, true);
    assert.deepEqual(await service.permissionsFor(admin.id), opened, 'a promotion prunes nothing');
    const identity = await service.identityOf(admin.id);
    assert.deepEqual(identity?.permissions, {}, 'dormant: the bypass answers, the grants do not');

    const down = await service.update(admin.id, { role: ADMIN_ROLES.PROOFREADER });

    assert.equal(down.isSuperAdmin, false);
    assert.deepEqual(down.permissions, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });
});

describe('AdminsService.setPermissions — the audit diff is what actually moved', () => {
  it('reports each feature that moved, from and to, and nothing for one that did not', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ);
    await grant(admin.id, FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);

    await auditContext.run(async () => {
      await service.setPermissions(admin.id, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        [FEATURE_KEYS.DATA_EXPORT]: null,
        [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
      });
      assert.deepEqual(auditContext.current()?.changed, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: {
          from: PERMISSION_LEVELS.READ,
          to: PERMISSION_LEVELS.WRITE,
        },
        [FEATURE_KEYS.QUESTION_MANAGEMENT]: { from: null, to: PERMISSION_LEVELS.READ },
      });
    });
  });

  /** A row claiming access moved when it had not would be a false record. */
  it('files nothing for a save that moved nothing', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);

    await auditContext.run(async () => {
      await service.setPermissions(admin.id, {
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        [FEATURE_KEYS.TEST_MANAGEMENT]: null,
      });
      assert.equal(auditContext.current()?.changed, null);
      assert.equal(auditContext.current()?.unchanged, true);
    });
  });
});

describe('AdminsService.update — the diff an admin edit contributes', () => {
  it('reports a promotion, driven through the live service', async () => {
    const { service, auditContext } = build();
    const admin = await makeAdmin(prisma, { isSuperAdmin: false });

    await auditContext.run(async () => {
      await service.update(admin.id, { role: ADMIN_ROLES.SUPER_ADMIN });
      assert.deepEqual(auditContext.current()?.changed, {
        role: { from: ADMIN_ROLES.ADMIN, to: ADMIN_ROLES.SUPER_ADMIN },
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

describe('AdminsService.identityOf — what an admin may do, read on every request', () => {
  /** The failure this prevents: a revoked permission honoured until the token next refreshed, up to 15 minutes. */
  it('drops a revoked grant on the very next read, and reaches nothing once deactivated', async () => {
    const { service } = build();
    const admin = await makeAdmin(prisma);
    const writes = async () => {
      const authority = await service.identityOf(admin.id);
      assert.ok(authority);
      return can(authority, FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
    };

    const students = (level: PermissionLevel | null) =>
      service.setPermissions(admin.id, { [FEATURE_KEYS.STUDENT_MANAGEMENT]: level });

    await students(PERMISSION_LEVELS.WRITE);
    assert.equal(await writes(), true);
    await students(null);
    assert.equal(await writes(), false);

    await students(PERMISSION_LEVELS.WRITE);
    await prisma.admin.update({ where: { id: admin.id }, data: { isActive: false } });
    assert.equal(await writes(), false);
    assert.equal(await service.identityOf(randomUUID()), null);
  });
});
