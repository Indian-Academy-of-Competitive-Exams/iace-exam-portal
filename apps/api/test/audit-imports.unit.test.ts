import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_ACTION, AUDIT_FEATURE } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { type AuthService } from '../src/auth';
import { ImportsService } from '../src/imports/imports.service';
import { IMPORT_LOG_STATUS } from '../src/common/importing';
import { FakePrisma, FakeStorage, makeGroup, makeStudent } from './support/fakes';

describe('AuditService.recordImportRows', () => {
  it('writes one thin row per touched entity, all pointing at the run', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never).recordImportRows('imp_1', AUDIT_FEATURE.STUDENT, [
      { entityId: 'stu_1', action: AUDIT_ACTION.CREATE },
      { entityId: 'stu_2', action: AUDIT_ACTION.UPDATE },
    ]);

    assert.equal(prisma.rowActionLogs.length, 2);
    assert.equal(prisma.rowActionLogs[0]?.importLogId, 'imp_1');
    assert.equal(prisma.rowActionLogs[1]?.action, AUDIT_ACTION.UPDATE);
  });

  /**
   * The trade this design made: per-row diffs for imports were dropped because a thousand-row
   * roster would write a thousand JSON blobs. The sheet in S3 is what replaces them.
   */
  it('never stores a diff for an imported row', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never).recordImportRows('imp_1', AUDIT_FEATURE.STUDENT, [
      { entityId: 'stu_1', action: AUDIT_ACTION.CREATE },
    ]);

    assert.equal(prisma.rowActionLogs[0]?.changed, null);
  });

  it('writes nothing for an import that touched nothing', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never).recordImportRows('imp_1', AUDIT_FEATURE.STUDENT, []);

    assert.equal(prisma.rowActionLogs.length, 0);
  });
});

const fakeAuth = (
  hashPin: (pin: string) => Promise<string> = (pin) => Promise.resolve(`hash:${pin}`),
) => ({ hashPin }) as unknown as AuthService;

describe('ImportsService.commitStudents — what an import run actually left behind', () => {
  /**
   * The row a plan would have created, the row it updated, and the row it could never write, all in
   * one file — because what matters is that the audit trail matches what happened, not the sheet.
   */
  it('opens the run at preview, closes it at commit, and logs only the rows it wrote', async () => {
    const prisma = new FakePrisma([
      makeStudent({ id: 'stu_existing', mobile: '9000000001', fullName: 'Already Here' }),
    ]);
    const storage = new FakeStorage();
    const service = new ImportsService(
      prisma.asService(),
      fakeAuth(),
      storage as never,
      new AuditService(prisma.asService()),
    );

    const result = await service.commitStudents(
      Buffer.from('mobile,fullName\n9876543210,Asha\n9000000001,Renamed\nnot-a-number,Bad'),
      'adm_1',
    );

    assert.deepEqual(
      { created: result.created, updated: result.updated, skipped: result.skipped },
      { created: 1, updated: 1, skipped: 1 },
    );

    // Exactly one run, moved from PREVIEWED to COMMITTED with the real counts —
    // never a second row for the same commit.
    assert.equal(prisma.importLogs.length, 1);
    const log = prisma.importLogs[0] as {
      id: string;
      status: string;
      created: number;
      updated: number;
      skipped: number;
      failed: number;
      fileS3Key: string | null;
    };
    assert.equal(log.status, IMPORT_LOG_STATUS.COMMITTED);
    assert.deepEqual(
      { created: log.created, updated: log.updated, skipped: log.skipped, failed: log.failed },
      { created: 1, updated: 1, skipped: 0, failed: 1 },
    );
    assert.equal(log.fileS3Key !== null && storage.objects.has(log.fileS3Key), true);

    // The invalid row wrote nothing and gets no audit entry — only the two rows the
    // commit actually touched, one created and one updated, never conflated.
    const created = prisma.students.find((s) => s.mobile === '9876543210');
    assert.equal(prisma.rowActionLogs.length, 2);
    assert.deepEqual(
      prisma.rowActionLogs.map((row) => ({ entityId: row.entityId, action: row.action })),
      [
        { entityId: created?.id, action: AUDIT_ACTION.CREATE },
        { entityId: 'stu_existing', action: AUDIT_ACTION.UPDATE },
      ],
    );
    assert.equal(
      prisma.rowActionLogs.every((row) => row.importLogId === log.id && row.changed === null),
      true,
    );
  });

  /**
   * The failure this prevents: a run that dies partway must not read as a clean commit, and the
   * rows it half-wrote must not be audited as if the whole file went through.
   */
  it('marks the run FAILED and writes no row actions when the commit throws partway', async () => {
    const prisma = new FakePrisma();
    const service = new ImportsService(
      prisma.asService(),
      fakeAuth(() => Promise.reject(new Error('argon2 unavailable'))),
      new FakeStorage() as never,
      new AuditService(prisma.asService()),
    );

    await assert.rejects(
      () => service.commitStudents(Buffer.from('mobile\n9876543210'), 'adm_1'),
      /argon2 unavailable/,
    );

    assert.equal(prisma.importLogs.length, 1);
    const log = prisma.importLogs[0] as { status: string; errors: { message: string } | null };
    assert.equal(log.status, IMPORT_LOG_STATUS.FAILED);
    assert.match(log.errors?.message ?? '', /argon2 unavailable/);
    assert.equal(prisma.rowActionLogs.length, 0);
  });
});

describe('ImportsService.commitGroupMembers — what an import run actually left behind', () => {
  it('logs only the rows it actually added, never an already-a-member row', async () => {
    const prisma = new FakePrisma(
      [
        makeStudent({ id: 'stu_a', mobile: '9000000001' }),
        makeStudent({ id: 'stu_b', mobile: '9000000002', directGroupIds: ['grp_1'] }),
      ],
      [],
      [],
      [makeGroup({ id: 'grp_1' })],
    );
    const service = new ImportsService(
      prisma.asService(),
      fakeAuth(),
      new FakeStorage() as never,
      new AuditService(prisma.asService()),
    );

    const result = await service.commitGroupMembers(
      'grp_1',
      Buffer.from('mobile\n9000000001\n9000000002\n9000000003'),
      'adm_1',
    );

    assert.equal(result.added, 1);
    assert.equal(prisma.rowActionLogs.length, 1);
    assert.deepEqual(
      { entityId: prisma.rowActionLogs[0]?.entityId, action: prisma.rowActionLogs[0]?.action },
      { entityId: 'stu_a', action: AUDIT_ACTION.UPDATE },
    );

    const log = prisma.importLogs[0] as {
      status: string;
      updated: number;
      skipped: number;
      failed: number;
    };
    assert.equal(log.status, IMPORT_LOG_STATUS.COMMITTED);
    assert.deepEqual(
      { updated: log.updated, skipped: log.skipped, failed: log.failed },
      { updated: 1, skipped: 1, failed: 1 },
    );
  });
});
