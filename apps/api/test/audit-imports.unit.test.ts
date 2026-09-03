import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { EVERY_BRANCH } from '../src/common/security';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  BRANCH_TYPE,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_STATUS,
  type AuditAction,
  type AuditFeature,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import { type StudentGrantsService } from '../src/access';
import { QuestionImportService } from '../src/questions/question-import.service';
import {
  FakeMessageSender,
  fakeStartingPins,
  FakePrisma,
  FakeQuestionBankPrisma,
  FakeStorage,
  makeBranch,
  makeStudent,
  makeSubject,
  makeTopic,
  roster,
  type FakeStudent,
} from './support/fakes';

/** Reaches the private closer directly — see the describe block that uses it for why. */
type ImportsServiceInternals = {
  closeRun: (
    logId: string,
    status: string,
    written: {
      feature: AuditFeature;
      rowActions: readonly { entityId: string; action: AuditAction }[];
      counts: { created: number; updated: number; skipped: number; failed: number };
      actorId: string;
    },
    failure?: { fileErrors: readonly string[]; error: unknown },
  ) => Promise<void>;
};

describe('AuditService.recordImportRows', () => {
  it('writes one thin row per touched entity, all pointing at the run', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never, new FakeStorage() as never).recordImportRows(
      'imp_1',
      AUDIT_FEATURE.STUDENT,
      [
        { entityId: 'stu_1', action: AUDIT_ACTION.CREATE },
        { entityId: 'stu_2', action: AUDIT_ACTION.UPDATE },
      ],
      'adm_1',
    );

    assert.equal(prisma.rowActionLogs.length, 2);
    assert.equal(prisma.rowActionLogs[0]?.importLogId, 'imp_1');
    assert.equal(prisma.rowActionLogs[1]?.action, AUDIT_ACTION.UPDATE);
  });

  /** The failure this prevents: an import's rows carrying no actor, so a normal admin can never find their own run. */
  it('attributes every row to the admin who ran the import', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never, new FakeStorage() as never).recordImportRows(
      'imp_1',
      AUDIT_FEATURE.STUDENT,
      [{ entityId: 'stu_1', action: AUDIT_ACTION.CREATE }],
      'adm_1',
    );

    assert.equal(prisma.rowActionLogs[0]?.actorId, 'adm_1');
  });

  /**
   * The trade this design made: per-row diffs for imports were dropped because a thousand-row
   * roster would write a thousand JSON blobs. The sheet in S3 is what replaces them.
   */
  it('never stores a diff for an imported row', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never, new FakeStorage() as never).recordImportRows(
      'imp_1',
      AUDIT_FEATURE.STUDENT,
      [{ entityId: 'stu_1', action: AUDIT_ACTION.CREATE }],
      'adm_1',
    );

    assert.equal(prisma.rowActionLogs[0]?.changed, null);
  });

  it('writes nothing for an import that touched nothing', async () => {
    const prisma = new FakePrisma();

    await new AuditService(prisma as never, new FakeStorage() as never).recordImportRows(
      'imp_1',
      AUDIT_FEATURE.STUDENT,
      [],
      'adm_1',
    );

    assert.equal(prisma.rowActionLogs.length, 0);
  });
});

/** A hash that refuses is how a run is made to die partway, which is what one test is about. */
const startingPins = (hash?: (pin: string) => Promise<string>) =>
  fakeStartingPins(new FakeMessageSender(), hash);

/** The scholarship path is not what these tests exercise, so the grants service is a stand-in. */
const fakeGrants = () =>
  ({ grantMany: () => Promise.resolve(0) }) as unknown as StudentGrantsService;

describe('ImportsService — a preview writes nothing at all', () => {
  /**
   * `ImportLog` and its S3 object are kept indefinitely. Opening one for a preview nobody commits
   * would be storage that never resolves — see `openRun`.
   */
  it('previewStudents opens no run and uploads no sheet', async () => {
    const prisma = new FakePrisma();
    const storage = new FakeStorage();
    const service = new ImportsService(
      prisma.asService(),
      startingPins(),
      storage as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

    await service.previewStudents(Buffer.from(roster('mobile\n9876543210')), EVERY_BRANCH);

    assert.equal(prisma.importLogs.length, 0);
    assert.equal(storage.objects.size, 0);
  });
});

/** The roster names the ONLINE branch, so the fake has to hold one for the rows to resolve. */
const importPrisma = (students: FakeStudent[] = []) =>
  new FakePrisma(
    students,
    [],
    [makeBranch({ id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL })],
  );

describe('ImportsService.commitStudents — what an import run actually left behind', () => {
  /**
   * The row a plan would have created, the row it updated, and the row it could never write, all in
   * one file — because what matters is that the audit trail matches what happened, not the sheet.
   */
  it('opens exactly one run at commit, and logs only the rows it wrote', async () => {
    const prisma = importPrisma([
      makeStudent({ id: 'stu_existing', mobile: '9000000001', fullName: 'Already Here' }),
    ]);
    const storage = new FakeStorage();
    const service = new ImportsService(
      prisma.asService(),
      startingPins(),
      storage as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

    const result = await service.commitStudents(
      Buffer.from(roster('mobile,fullName\n9876543210,Asha\n9000000001,Renamed\nnot-a-number,Bad')),
      'adm_1',
      EVERY_BRANCH,
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
      prisma.rowActionLogs.every(
        (row) => row.importLogId === log.id && row.changed === null && row.actorId === 'adm_1',
      ),
      true,
    );
  });

  /**
   * The failure this prevents: a run that dies partway must not read as a clean commit, and the
   * rows it half-wrote must not be audited as if the whole file went through.
   */
  it('marks the run FAILED and writes no row actions when it throws before writing anything', async () => {
    const prisma = importPrisma();
    const service = new ImportsService(
      prisma.asService(),
      startingPins(() => Promise.reject(new Error('argon2 unavailable'))),
      new FakeStorage() as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

    await assert.rejects(
      () =>
        service.commitStudents(Buffer.from(roster('mobile\n9876543210')), 'adm_1', EVERY_BRANCH),
      /argon2 unavailable/,
    );

    assert.equal(prisma.importLogs.length, 1);
    const log = prisma.importLogs[0] as { status: string; errors: { message: string } | null };
    assert.equal(log.status, IMPORT_LOG_STATUS.FAILED);
    assert.match(log.errors?.message ?? '', /argon2 unavailable/);
    assert.equal(prisma.rowActionLogs.length, 0);
  });

  /**
   * The failure this prevents: the loop is not a transaction, so a throw on row three leaves rows
   * one and two in the database. Discarding the accumulated row actions and closing the run at zero
   * would leave those two students created by nobody, under a run that says it created nothing —
   * no audit entry at all, plus a durable record contradicting what happened.
   */
  it('records the rows it did write when the commit throws partway through the loop', async () => {
    const prisma = importPrisma();
    prisma.studentWriteLimit = 2;
    const service = new ImportsService(
      prisma.asService(),
      startingPins(),
      new FakeStorage() as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

    await assert.rejects(
      () =>
        service.commitStudents(
          Buffer.from(roster('mobile\n9000000001\n9000000002\n9000000003')),
          'adm_1',
          EVERY_BRANCH,
        ),
      /student write failed/,
    );

    assert.equal(prisma.students.length, 2);
    assert.deepEqual(
      prisma.rowActionLogs.map((row) => ({ entityId: row.entityId, action: row.action })),
      prisma.students.map((student) => ({
        entityId: student.id,
        action: AUDIT_ACTION.CREATE,
      })),
    );

    const log = prisma.importLogs[0] as {
      status: string;
      created: number;
      updated: number;
    };
    assert.equal(log.status, IMPORT_LOG_STATUS.FAILED);
    assert.deepEqual({ created: log.created, updated: log.updated }, { created: 2, updated: 0 });
  });

  /**
   * The mirror image of the test above: by the time the audit write runs, the student rows are
   * already durable. Losing the audit trail is a cost to pay, never a reason to relabel a commit
   * that already happened as a failure — that is exactly the lie `failRun` exists to prevent.
   */
  it('ends COMMITTED with the student write intact even when recordImportRows throws', async () => {
    const prisma = importPrisma();
    const throwingAudit = {
      recordImportRows: () => Promise.reject(new Error('audit db unreachable')),
    } as unknown as AuditService;
    const service = new ImportsService(
      prisma.asService(),
      startingPins(),
      new FakeStorage() as never,
      throwingAudit,
      fakeGrants(),
    );

    const result = await service.commitStudents(
      Buffer.from(roster('mobile\n9876543210')),
      'adm_1',
      EVERY_BRANCH,
    );

    assert.equal(result.created, 1);
    assert.equal(
      prisma.students.some((s) => s.mobile === '9876543210'),
      true,
    );

    assert.equal(prisma.importLogs.length, 1);
    const log = prisma.importLogs[0] as { status: string; created: number };
    assert.equal(log.status, IMPORT_LOG_STATUS.COMMITTED);
    assert.equal(log.created, 1);

    // The audit write never landed — that is the cost, not a lie about the import.
    assert.equal(prisma.rowActionLogs.length, 0);
  });
});

describe('ImportsService — a failed close preserves what openRun already recorded', () => {
  /**
   * `plan.fileErrors` is only ever non-empty when there is nothing left to write, so this path
   * cannot be reached through a real commit — exercised directly against the private helper.
   */
  it('keeps the fileErrors recorded at open alongside the failure message', async () => {
    const prisma = new FakePrisma();
    const service = new ImportsService(
      prisma.asService(),
      startingPins(),
      new FakeStorage() as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );
    const opened = await prisma.importLog.create({
      data: {
        feature: AUDIT_FEATURE.STUDENT,
        source: IMPORT_SOURCE.SHEET,
        actorId: 'adm_1',
        total: 0,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: { fileErrors: ['Missing the "Mobile Number" column'] },
      },
    });

    await (service as unknown as ImportsServiceInternals).closeRun(
      opened.id,
      IMPORT_LOG_STATUS.FAILED,
      {
        feature: AUDIT_FEATURE.STUDENT,
        rowActions: [],
        counts: { created: 0, updated: 0, skipped: 0, failed: 0 },
        actorId: 'adm_1',
      },
      { fileErrors: ['Missing the "Mobile Number" column'], error: new Error('db exploded') },
    );

    const failed = prisma.importLogs.find((row) => row.id === opened.id) as {
      status: string;
      errors: { fileErrors?: string[]; message: string };
    };
    assert.equal(failed.status, IMPORT_LOG_STATUS.FAILED);
    assert.deepEqual(failed.errors.fileErrors, ['Missing the "Mobile Number" column']);
    assert.equal(failed.errors.message, 'db exploded');
  });
});

// ============================================================================
// The third importer. It predates this slice and was the one ImportLog producer
// already in the tree, so it was in no task's file list — and wrote no audit at
// all while editing a single question by hand wrote one.
// ============================================================================

/** A complete MCQ row, by column key. No commas in any value: this is written out as CSV. */
const QUESTION_ROW: Partial<Record<QuestionImportColumnKey, string>> = {
  subject: 'Quantitative Aptitude',
  topic: 'Arithmetic',
  difficulty: 'medium',
  option1_en: '25',
  option2_en: '30',
  option3_en: '35',
  option4_en: '40',
  correct_option: '2',
};

function questionSheet(...stems: string[]): Buffer {
  const header = QUESTION_IMPORT_COLUMNS.map((column) => column.header).join(',');
  const lines = stems.map((stem) =>
    QUESTION_IMPORT_COLUMNS.map(
      (column) => ({ ...QUESTION_ROW, stem_en: stem })[column.key as QuestionImportColumnKey] ?? '',
    ).join(','),
  );
  return Buffer.from([header, ...lines].join('\n'));
}

function questionBank() {
  const prisma = new FakeQuestionBankPrisma(
    [],
    [makeSubject({ id: 'sub_1' })],
    [makeTopic({ id: 'top_1' })],
  );
  const storage = new FakeStorage();
  return {
    prisma,
    storage,
    service: new QuestionImportService(
      prisma.asService(),
      storage as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
    ),
  };
}

describe('QuestionImportService.commit — the rows a question sheet leaves behind', () => {
  /**
   * The failure this prevents: a thousand-question import leaving zero RowActionLog rows, so the
   * Imports tab lists the run and nothing reachable from the Activity tab, or from a question's
   * own history, can say where any of those questions came from.
   */
  it('writes one audit row per created question, pointing at the run', async () => {
    const { prisma, service } = questionBank();

    await service.preview(questionSheet('What is 20% of 150?', 'What is 30% of 200?'), 'adm_1');
    const logId = prisma.importLogs[0]?.id as string;

    const result = await service.commit(logId, QUESTION_STATUS.DRAFT);

    assert.equal(result.created, 2);
    assert.deepEqual(
      prisma.rowActionLogs.map((row) => ({
        entityId: row.entityId,
        action: row.action,
        feature: row.feature,
        importLogId: row.importLogId,
        actorId: row.actorId,
      })),
      prisma.questions.map((question) => ({
        entityId: question.id,
        action: AUDIT_ACTION.CREATE,
        feature: AUDIT_FEATURE.QUESTION,
        importLogId: logId,
        actorId: 'adm_1',
      })),
    );
  });

  /** Same trade the roster importer makes: the sheet in S3 is what stands in for per-row diffs. */
  it('stores no diff for an imported question', async () => {
    const { prisma, service } = questionBank();

    await service.preview(questionSheet('What is 20% of 150?'), 'adm_1');
    await service.commit(prisma.importLogs[0]?.id as string, QUESTION_STATUS.DRAFT);

    assert.equal(prisma.rowActionLogs[0]?.changed, null);
  });
});

describe('QuestionImportService.commit — the status the run lands in', () => {
  /** The failure this prevents: a 400-row sheet going live the moment it commits. */
  it('writes every row in the status the run chose', async () => {
    const { prisma, service } = questionBank();
    await service.preview(questionSheet('What is 20% of 150?', 'What is 30% of 200?'), 'adm_1');

    await service.commit(prisma.importLogs[0]?.id as string, QUESTION_STATUS.DRAFT);

    assert.equal(prisma.questions.length, 2);
    for (const question of prisma.questions) {
      assert.equal(question.status, QUESTION_STATUS.DRAFT);
    }
  });

  it('puts them straight into the bank when that is what was asked for', async () => {
    const { prisma, service } = questionBank();
    await service.preview(questionSheet('What is 20% of 150?'), 'adm_1');

    await service.commit(prisma.importLogs[0]?.id as string, QUESTION_STATUS.ACTIVE);

    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.ACTIVE);
  });
});

describe('ImportsService — the branches the admin uploading may write into', () => {
  const held = { all: false, branchIds: ['br_online'] } as const;

  const serviceOn = (prisma: ReturnType<typeof importPrisma>) =>
    new ImportsService(
      prisma.asService(),
      startingPins(),
      new FakeStorage() as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

  /** The failure this prevents: a scope reaching the planner on preview but not on commit. */
  it('writes the row at a branch it holds and refuses the one it does not', async () => {
    const prisma = new FakePrisma(
      [],
      [],
      [
        makeBranch({ id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL }),
        makeBranch({ id: 'br_other', name: 'KUKATPALLY', type: BRANCH_TYPE.VIRTUAL }),
      ],
    );

    const result = await serviceOn(prisma).commitStudents(
      Buffer.from(
        'Mobile,Full Name,Student Type,Branch Name,Enrolled Families,Enrolled Exams,Programs\n' +
          '9876543210,Asha,ONLINE,ONLINE,SSC,,\n' +
          '9876543211,Bela,ONLINE,KUKATPALLY,SSC,,',
      ),
      'adm_1',
      held,
    );

    assert.equal(result.created, 1);
    assert.deepEqual(
      prisma.students.map((student) => student.mobile),
      ['9876543210'],
    );
  });

  it('shows the same refusal on preview', async () => {
    const prisma = new FakePrisma(
      [],
      [],
      [makeBranch({ id: 'br_other', name: 'KUKATPALLY', type: BRANCH_TYPE.VIRTUAL })],
    );

    const plan = await serviceOn(prisma).previewStudents(
      Buffer.from(
        'Mobile,Full Name,Student Type,Branch Name,Enrolled Families,Enrolled Exams,Programs\n' +
          '9876543211,Bela,ONLINE,KUKATPALLY,SSC,,',
      ),
      held,
    );

    assert.equal(plan.summary.invalid, 1);
    assert.ok(plan.rows[0]?.errors.some((e) => e.includes('not one of your branches')));
  });

  /** A scholarship intake grants by mobile alone, so a scoped admin could reach anybody's student. */
  it('refuses a scholarship intake from an admin who does not reach every branch', async () => {
    const prisma = importPrisma();

    for (const run of [
      () => serviceOn(prisma).previewScholarship('srs_1', Buffer.from('Mobile\n9876543210'), held),
      () =>
        serviceOn(prisma).commitScholarship(
          'srs_1',
          Buffer.from('Mobile\n9876543210'),
          'adm_1',
          held,
        ),
    ]) {
      const error = await run().catch((e: unknown) => e);
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
    }
  });
});
