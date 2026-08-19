import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_FEATURE, AppException, ErrorCodes } from '@iace/contracts';
import { AuditService, type AuditViewer } from '../src/audit/audit.service';
import { FakePrisma } from './support/fakes';

function viewer(overrides: Partial<AuditViewer> = {}): AuditViewer {
  return { id: 'adm_1', isSuperAdmin: false, isActive: true, ...overrides };
}

function seeded() {
  const prisma = new FakePrisma();
  prisma.rowActionLogs.push(
    {
      id: 'r1',
      actorId: 'adm_1',
      feature: 'STUDENT',
      entityId: 'stu_1',
      action: 'UPDATE',
      actorType: 'ADMIN',
      changed: null,
      importLogId: null,
      createdAt: new Date('2026-08-10T09:00:00.000Z'),
    },
    {
      id: 'r2',
      actorId: 'adm_2',
      feature: 'STUDENT',
      entityId: 'stu_1',
      action: 'BLOCK',
      actorType: 'ADMIN',
      changed: null,
      importLogId: null,
      createdAt: new Date('2026-08-10T09:05:00.000Z'),
    },
  );
  return { prisma, service: new AuditService(prisma as never) };
}

describe('AuditService.listRowActions', () => {
  it('shows a super admin everything', async () => {
    const { service } = seeded();

    const page = await service.listRowActions(
      { page: 1, pageSize: 20 } as never,
      viewer({ isSuperAdmin: true }),
    );

    assert.equal(page.total, 2);
  });

  /**
   * The failure this feature exists to prevent: a normal admin reading somebody else's actions
   * by asking for them. The service overwrites the filter rather than validating it.
   */
  it('shows a normal admin only their own, even when they ask for another admin', async () => {
    const { service } = seeded();

    const page = await service.listRowActions(
      { page: 1, pageSize: 20, actorId: 'adm_2' } as never,
      viewer(),
    );

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.actorId, 'adm_1');
  });

  it('filters an entity history to that entity', async () => {
    const { service } = seeded();

    const page = await service.listRowActions(
      { page: 1, pageSize: 20, feature: AUDIT_FEATURE.STUDENT, entityId: 'stu_1' } as never,
      viewer({ isSuperAdmin: true }),
    );

    assert.equal(page.total, 2);
  });

  it('resolves actor names from the admin table, one lookup for the whole page', async () => {
    const { prisma, service } = seeded();
    prisma.admins.push(
      {
        id: 'adm_1',
        email: 'one@iace.co.in',
        fullName: 'Admin One',
        isSuperAdmin: false,
        isActive: true,
      },
      {
        id: 'adm_2',
        email: 'two@iace.co.in',
        fullName: 'Admin Two',
        isSuperAdmin: false,
        isActive: true,
      },
    );

    const page = await service.listRowActions(
      { page: 1, pageSize: 20 } as never,
      viewer({ isSuperAdmin: true }),
    );

    const byId = new Map(page.items.map((row) => [row.actorId, row.actorName]));
    assert.equal(byId.get('adm_1'), 'Admin One');
    assert.equal(byId.get('adm_2'), 'Admin Two');
  });

  /**
   * The failure this prevents: an actor with no name to find — a SCRIPT row, or an actorId with
   * no matching admin — reading as a thrown error or a raw id, instead of plainly "no name".
   */
  it('leaves actorName null for a SCRIPT actor and an actorId with no admin row', async () => {
    const { prisma, service } = seeded();
    prisma.rowActionLogs.push({
      id: 'r3',
      actorId: null,
      feature: 'STUDENT',
      entityId: 'stu_1',
      action: 'IMPORT',
      actorType: 'SCRIPT',
      changed: null,
      importLogId: null,
      createdAt: new Date('2026-08-10T09:10:00.000Z'),
    });
    // No admin row for 'adm_2' is seeded here, so its row (r2, from `seeded()`) resolves to nothing.

    const page = await service.listRowActions(
      { page: 1, pageSize: 20 } as never,
      viewer({ isSuperAdmin: true }),
    );

    const byId = new Map(page.items.map((row) => [row.id, row.actorName]));
    assert.equal(byId.get('r3'), null);
    assert.equal(byId.get('r2'), null);
  });

  /**
   * The failure this prevents: a deactivated admin who can still sign in reading audit history
   * indefinitely, because nothing on this always-on route checks the flag.
   */
  it('refuses a deactivated admin', async () => {
    const { service } = seeded();

    await assert.rejects(
      () => service.listRowActions({ page: 1, pageSize: 20 } as never, viewer({ isActive: false })),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
  });

  /**
   * The failure this prevents: a malformed date reaching Prisma as `Invalid Date` and surfacing
   * as a 500 for something a user typed, instead of a 400 the client can show on the field.
   */
  it('refuses a from/to that is not a valid date, rather than passing it through', async () => {
    const { service } = seeded();

    await assert.rejects(
      () =>
        service.listRowActions(
          { page: 1, pageSize: 20, from: 'nope' } as never,
          viewer({ isSuperAdmin: true }),
        ),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });

  /**
   * The failure this prevents: `to=2026-08-10` reading as that day's midnight and silently
   * dropping every row from later the same day.
   */
  it('a date-only `to` includes the whole of that day', async () => {
    const { service } = seeded();

    const page = await service.listRowActions(
      { page: 1, pageSize: 20, to: '2026-08-10' } as never,
      viewer({ isSuperAdmin: true }),
    );

    assert.equal(page.total, 2);
  });

  /**
   * The failure this prevents: `recordImportRows` writes hundreds of rows through one
   * `createMany`, sharing a single `createdAt` — a skip/take page with no tiebreaker can then
   * repeat or drop rows as an admin pages through them.
   */
  it('does not repeat or drop rows across pages when createdAt ties', async () => {
    const prisma = new FakePrisma();
    const tiedAt = new Date('2026-08-10T09:00:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      prisma.rowActionLogs.push({
        id: `t${i}`,
        actorId: 'adm_1',
        feature: 'STUDENT',
        entityId: 'stu_1',
        action: 'UPDATE',
        actorType: 'ADMIN',
        changed: null,
        importLogId: null,
        createdAt: tiedAt,
      });
    }
    const service = new AuditService(prisma as never);

    const seen: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const result = await service.listRowActions(
        { page, pageSize: 1 } as never,
        viewer({ isSuperAdmin: true }),
      );
      seen.push(...result.items.map((item) => item.id));
    }

    assert.equal(new Set(seen).size, 5);
  });
});

describe('AuditService.listImports', () => {
  function seededImports() {
    const prisma = new FakePrisma();
    prisma.importLogs.push(
      {
        id: 'imp_1',
        feature: 'STUDENT',
        source: 'FILE',
        actorId: 'adm_1',
        total: 10,
        created: 10,
        updated: 0,
        skipped: 0,
        failed: 0,
        status: 'COMMITTED',
        startedAt: new Date('2026-08-10T09:00:00.000Z'),
        finishedAt: new Date('2026-08-10T09:01:00.000Z'),
      },
      {
        id: 'imp_2',
        feature: 'STUDENT',
        source: 'FILE',
        actorId: 'adm_2',
        total: 5,
        created: 5,
        updated: 0,
        skipped: 0,
        failed: 0,
        status: 'COMMITTED',
        startedAt: new Date('2026-08-10T09:05:00.000Z'),
        finishedAt: new Date('2026-08-10T09:06:00.000Z'),
      },
    );
    return { prisma, service: new AuditService(prisma as never) };
  }

  it('shows a super admin every import run', async () => {
    const { service } = seededImports();

    const page = await service.listImports(
      { page: 1, pageSize: 20 } as never,
      viewer({ isSuperAdmin: true }),
    );

    assert.equal(page.total, 2);
  });

  /**
   * The failure this feature exists to prevent: a normal admin reading somebody else's import
   * runs by asking for them. The scope is not a filter the request controls.
   */
  it('shows a normal admin only the import runs they started', async () => {
    const { service } = seededImports();

    const page = await service.listImports({ page: 1, pageSize: 20 } as never, viewer());

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.actorId, 'adm_1');
  });

  /** Same rule as `listRowActions` — the two routes share one always-on guard against nothing. */
  it('refuses a deactivated admin', async () => {
    const { service } = seededImports();

    await assert.rejects(
      () => service.listImports({ page: 1, pageSize: 20 } as never, viewer({ isActive: false })),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
  });
});
