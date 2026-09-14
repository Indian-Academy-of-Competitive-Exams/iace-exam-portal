import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_FEATURE,
  AppException,
  ErrorCodes,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  rowActionListQuerySchema,
  type RowActionListQueryInput,
} from '@iace/contracts';
import { AuditService, type AuditViewer } from '../src/audit/audit.service';
import { FakeStorage } from '../test/support/fakes';
import { resetDatabase, rowActions, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function viewer(overrides: Partial<AuditViewer> = {}): AuditViewer {
  return { id: 'adm_1', isSuperAdmin: false, isActive: true, ...overrides };
}

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

const service = (storage = new FakeStorage()) => new AuditService(prisma, storage as never);

const admins = (names: Record<string, string>) =>
  prisma.admin.createMany({
    data: Object.entries(names).map(([id, fullName]) => ({
      id,
      fullName,
      email: `${id}@iace.test`,
    })),
  });

describe('AuditService.record', () => {
  it('writes the row exactly as the event describes it', async () => {
    await service().record({
      feature: AUDIT_FEATURE.STUDENT,
      action: AUDIT_ACTION.BLOCK,
      entityId: 'stu_1',
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      actorId: 'adm_1',
      changed: { isTestBlocked: { from: false, to: true } },
    });

    const [row, ...others] = await prisma.rowActionLog.findMany();
    assert.equal(others.length, 0);
    assert.equal(row?.entityId, 'stu_1');
    assert.equal(row?.action, AUDIT_ACTION.BLOCK);
    assert.deepEqual(row?.changed, { isTestBlocked: { from: false, to: true } });
  });
});

describe('AuditService.listRowActions', () => {
  /** One update by adm_1 and a block by adm_2 five minutes later, both on stu_1. */
  const seeded = () =>
    rowActions(prisma, [
      { id: 'r1', actorId: 'adm_1', createdAt: new Date('2026-08-10T09:00:00.000Z') },
      {
        id: 'r2',
        actorId: 'adm_2',
        action: AUDIT_ACTION.BLOCK,
        createdAt: new Date('2026-08-10T09:05:00.000Z'),
      },
    ]);

  /** Parsed by the same schema the controller applies, so a filter arrives in the shape it is read in. */
  const list = (query: RowActionListQueryInput, who: AuditViewer) =>
    service().listRowActions(
      rowActionListQuerySchema.parse({ page: 1, pageSize: 20, ...query }),
      who,
    );

  it('shows a super admin everything, and an entity history only that entity', async () => {
    await seeded();
    await rowActions(prisma, [{ id: 'r_other', entityId: 'stu_2' }]);

    const everything = await list({}, viewer({ isSuperAdmin: true }));
    const history = await list(
      { feature: AUDIT_FEATURE.STUDENT, entityId: 'stu_1' },
      viewer({ isSuperAdmin: true }),
    );

    assert.equal(everything.total, 3);
    assert.equal(history.total, 2);
  });

  /** The failure this feature exists to prevent: a normal admin reading somebody else's actions by asking. */
  it('shows a normal admin only their own, even when they ask for another admin', async () => {
    await seeded();

    const page = await list({ actorId: 'adm_2' }, viewer());

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.actorId, 'adm_1');
  });

  it('resolves actor names from the admin table, one lookup for the whole page', async () => {
    await seeded();
    await admins({ adm_1: 'Admin One', adm_2: 'Admin Two' });

    const page = await list({}, viewer({ isSuperAdmin: true }));

    const byId = new Map(page.items.map((row) => [row.actorId, row.actorName]));
    assert.equal(byId.get('adm_1'), 'Admin One');
    assert.equal(byId.get('adm_2'), 'Admin Two');
  });

  /** The failure this prevents: a SCRIPT row, or an actor with no admin row, reading as an error or a raw id. */
  it('leaves actorName null for a SCRIPT actor and an actorId with no admin row', async () => {
    await seeded();
    await admins({ adm_1: 'Admin One' });
    await rowActions(prisma, [
      {
        id: 'r3',
        actorId: null,
        actorType: AUDIT_ACTOR_TYPE.SCRIPT,
        action: AUDIT_ACTION.IMPORT,
        createdAt: new Date('2026-08-10T09:10:00.000Z'),
      },
    ]);

    const page = await list({}, viewer({ isSuperAdmin: true }));

    const byId = new Map(page.items.map((row) => [row.id, row.actorName]));
    assert.equal(byId.get('r3'), null);
    assert.equal(byId.get('r2'), null);
  });

  /** The failure this prevents: a deactivated admin still reading audit history on an always-on route. */
  it('refuses a deactivated admin', async () => {
    await seeded();

    await assert.rejects(
      () => list({}, viewer({ isActive: false })),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });

  /** The failure this prevents: a malformed date reaching Postgres and surfacing as a 500. */
  it('refuses a from/to that is not a valid date, rather than passing it through', async () => {
    await seeded();

    await assert.rejects(
      // Past the schema on purpose: the service is the last line, and must not trust its caller.
      () =>
        service().listRowActions(
          { page: 1, pageSize: 20, from: 'nope' } as never,
          viewer({ isSuperAdmin: true }),
        ),
      refusedWith(ErrorCodes.VALIDATION_ERROR),
    );
  });

  /** The failure this prevents: `to=2026-08-10` reading as that day's midnight and dropping the day. */
  it('a date-only `to` includes the whole of that day', async () => {
    await seeded();

    assert.equal((await list({ to: '2026-08-10' }, viewer({ isSuperAdmin: true }))).total, 2);
  });

  /** The failure this prevents: rows sharing one createdAt repeating or vanishing as an admin pages. */
  it('does not repeat or drop rows across pages when createdAt ties', async () => {
    const tiedAt = new Date('2026-08-10T09:00:00.000Z');
    await rowActions(
      prisma,
      Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, createdAt: tiedAt })),
    );

    const seen: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const result = await service().listRowActions(
        { page, pageSize: 1 } as never,
        viewer({ isSuperAdmin: true }),
      );
      seen.push(...result.items.map((item) => item.id));
    }

    assert.equal(new Set(seen).size, 5);
  });
});

const KEY = 'imports/student/imp_1.xlsx';

/** Three committed runs: adm_1's and adm_2's each with its sheet, and a second of adm_1's with none. */
const importRuns = () =>
  prisma.importLog.createMany({
    data: [
      { id: 'imp_1', actorId: 'adm_1', fileS3Key: KEY, total: 10, created: 10 },
      {
        id: 'imp_2',
        actorId: 'adm_2',
        fileS3Key: 'imports/student/imp_2.xlsx',
        total: 5,
        created: 5,
      },
      { id: 'imp_3', actorId: 'adm_1', fileS3Key: null },
    ].map((run) => ({
      feature: AUDIT_FEATURE.STUDENT,
      source: IMPORT_SOURCE.SHEET,
      status: IMPORT_LOG_STATUS.COMMITTED,
      ...run,
    })),
  });

describe('AuditService.listImports', () => {
  const list = (who: AuditViewer) => service().listImports({ page: 1, pageSize: 20 } as never, who);

  it('shows a super admin every import run, and a normal admin only the ones they started', async () => {
    await importRuns();

    const everyone = await list(viewer({ isSuperAdmin: true }));
    const mine = await list(viewer());

    assert.equal(everyone.total, 3);
    assert.equal(mine.total, 2);
    assert.ok(mine.items.every((run) => run.actorId === 'adm_1'));
  });

  /** Same rule as `listRowActions` — the two routes share one always-on guard. */
  it('refuses a deactivated admin', async () => {
    await importRuns();

    await assert.rejects(
      () => list(viewer({ isActive: false })),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });

  it('says which runs still have their file, and never puts the S3 key in the response', async () => {
    await importRuns();

    const page = await list(viewer({ isSuperAdmin: true }));

    assert.equal(page.items.find((run) => run.id === 'imp_1')?.hasFile, true);
    assert.equal(page.items.find((run) => run.id === 'imp_3')?.hasFile, false);
    assert.ok(!JSON.stringify(page).includes(KEY));
  });
});

describe('AuditService.importFile', () => {
  const seeded = async () => {
    await importRuns();
    const storage = new FakeStorage();
    await storage.upload(KEY, Buffer.from('the sheet'));
    await storage.upload('imports/student/imp_2.xlsx', Buffer.from('someone else sheet'));
    return service(storage);
  };

  it('hands back the bytes that were uploaded, named after the run so a download is traceable', async () => {
    const audit = await seeded();

    const file = await audit.importFile('imp_1', viewer());

    assert.equal(file.body.toString(), 'the sheet');
    assert.equal(file.filename, 'student-import-imp_1.xlsx');
  });

  /** Guessing a run id to reach a sheet of names, mobiles and DOBs is a breach, not a mis-scoped list. */
  it('refuses a normal admin another admin run, even with the right id, and lets a super admin', async () => {
    const audit = await seeded();

    await assert.rejects(
      () => audit.importFile('imp_2', viewer()),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
    assert.ok(await audit.importFile('imp_2', viewer({ isSuperAdmin: true })));
  });

  it('refuses a run that kept no file, and a deactivated admin', async () => {
    const audit = await seeded();

    await assert.rejects(
      () => audit.importFile('imp_3', viewer()),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
    await assert.rejects(
      () => audit.importFile('imp_1', viewer({ isActive: false })),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });
});
