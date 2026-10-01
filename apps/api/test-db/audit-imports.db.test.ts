import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  BRANCH_TYPE,
  IMPORT_LOG_STATUS,
  IMPORT_SOURCE,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_STATUS,
  XLSX_CONTENT_TYPE,
  type AuditAction,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QuestionImportService } from '../src/questions/question-import.service';
import {
  FakeEventsService,
  FakeMessageSender,
  FakeProgramsService,
  FakeStorage,
  fakeStartingPins,
  roster,
} from '../test/support/fakes';
import { makeQuestionBank, makeStudent, resetDatabase, testPrisma } from './support/database';

const ADMIN = randomUUID();
const IMP_1 = randomUUID();
const STU_1 = randomUUID();
const STU_2 = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Reaches the private closer directly — see the describe block that uses it for why. */
type ImportsServiceInternals = {
  closeRun: (
    logId: string,
    status: string,
    written: {
      rowActions: readonly { entityId: string; action: AuditAction }[];
      counts: { created: number; updated: number; skipped: number; failed: number };
    },
    actorId: string,
    failure?: { fileErrors: readonly string[]; error: unknown },
  ) => Promise<void>;
};

const rowActions = () => prisma.rowActionLog.findMany({ orderBy: { createdAt: 'asc' } });

const importLogs = () => prisma.importLog.findMany();

describe('AuditService.recordImportRows', () => {
  const record = (rows: readonly { entityId: string; action: AuditAction }[]) =>
    new AuditService(prisma, new FakeStorage() as never).recordImportRows(
      IMP_1,
      AUDIT_FEATURE.STUDENT,
      rows,
      ADMIN,
    );

  /** The trade this design made: the sheet in S3 stands in for a thousand per-row JSON diffs. */
  it('writes one thin row per touched entity, all pointing at the run, attributed and with no diff', async () => {
    // The run has to exist: a row pointing at an import nobody opened is refused by its foreign key.
    await prisma.importLog.create({
      data: {
        id: IMP_1,
        feature: AUDIT_FEATURE.STUDENT,
        source: IMPORT_SOURCE.SHEET,
        actorId: ADMIN,
        total: 2,
        status: IMPORT_LOG_STATUS.PREVIEWED,
      },
    });
    await record([
      { entityId: STU_1, action: AUDIT_ACTION.CREATE },
      { entityId: STU_2, action: AUDIT_ACTION.UPDATE },
    ]);

    const rows = await rowActions();
    assert.deepEqual(
      rows.map((row) => [row.entityId, row.action]).sort(),
      [
        [STU_1, AUDIT_ACTION.CREATE],
        [STU_2, AUDIT_ACTION.UPDATE],
      ].sort(),
    );
    assert.ok(
      rows.every(
        (row) => row.importLogId === IMP_1 && row.actorId === ADMIN && row.changed === null,
      ),
    );
  });

  it('writes nothing for an import that touched nothing', async () => {
    await record([]);

    assert.equal(await prisma.rowActionLog.count(), 0);
  });
});

/** A hash that refuses is how a run is made to die partway, which is what one test is about. */
const startingPins = (hash?: (pin: string) => Promise<string>) =>
  fakeStartingPins(new FakeMessageSender(), hash);

const importsOn = (
  client: PrismaService = prisma,
  over: {
    hash?: (pin: string) => Promise<string>;
    audit?: AuditService;
    storage?: FakeStorage;
  } = {},
) =>
  new ImportsService(
    client,
    startingPins(over.hash),
    (over.storage ?? new FakeStorage()) as never,
    over.audit ?? new AuditService(prisma, new FakeStorage() as never),
    // The event path is not what these tests exercise — see event-candidate-import.
    new FakeEventsService().asService(),
    new FakeProgramsService().asService(),
  );

/** The roster names the ONLINE branch, so the database has to hold one for the rows to resolve. */
const onlineBranch = () =>
  prisma.branch.create({ data: { name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL } });

describe('ImportsService — a preview writes nothing at all', () => {
  /** `ImportLog` and its S3 object are kept indefinitely; a preview nobody commits must open neither. */
  it('previewStudents opens no run and uploads no sheet', async () => {
    await onlineBranch();
    const storage = new FakeStorage();

    await importsOn(prisma, { storage }).previewStudents(Buffer.from(roster('mobile\n9876543210')));

    assert.equal(await prisma.importLog.count(), 0);
    assert.equal(storage.objects.size, 0);
  });
});

describe('ImportsService.commitStudents — what an import run actually left behind', () => {
  /** What matters is that the audit trail matches what happened, not what the sheet said. */
  it('opens exactly one run at commit, and logs only the rows it wrote', async () => {
    await onlineBranch();
    const existing = await makeStudent(prisma, { mobile: '9000000001', fullName: 'Already Here' });
    const storage = new FakeStorage();

    const result = await importsOn(prisma, { storage }).commitStudents(
      Buffer.from(roster('mobile,fullName\n9876543210,Asha\n9000000001,Renamed\nnot-a-number,Bad')),
      ADMIN,
    );

    assert.deepEqual(
      { created: result.created, updated: result.updated, skipped: result.skipped },
      { created: 1, updated: 1, skipped: 1 },
    );
    // Exactly one run, moved from PREVIEWED to COMMITTED with the real counts.
    const [log, ...others] = await importLogs();
    assert.equal(others.length, 0);
    assert.equal(log?.status, IMPORT_LOG_STATUS.COMMITTED);
    assert.deepEqual([log?.created, log?.updated, log?.skipped, log?.failed], [1, 1, 1, 0]);
    assert.ok(storage.objects.has(log?.fileS3Key ?? ''), 'the run names the sheet it stored');

    // The invalid row wrote nothing and gets no audit entry — only the two rows the commit touched.
    const created = await prisma.student.findFirstOrThrow({ where: { mobile: '9876543210' } });
    const rows = await rowActions();
    assert.deepEqual(
      rows.map((row) => [row.entityId, row.action]).sort(),
      [
        [created.id, AUDIT_ACTION.CREATE],
        [existing.id, AUDIT_ACTION.UPDATE],
      ].sort(),
    );
    assert.ok(
      rows.every(
        (row) => row.importLogId === log?.id && row.changed === null && row.actorId === ADMIN,
      ),
    );
  });

  /** The failure this prevents: a run that dies partway reading as a clean commit. */
  it('marks the run FAILED and writes no row actions when it throws before writing anything', async () => {
    await onlineBranch();

    await assert.rejects(
      () =>
        importsOn(prisma, {
          hash: () => Promise.reject(new Error('argon2 unavailable')),
        }).commitStudents(Buffer.from(roster('mobile\n9876543210')), ADMIN),
      /argon2 unavailable/,
    );

    const [log, ...others] = await importLogs();
    assert.equal(others.length, 0);
    assert.equal(log?.status, IMPORT_LOG_STATUS.FAILED);
    assert.match((log?.errors as { message?: string } | null)?.message ?? '', /argon2 unavailable/);
    assert.equal(await prisma.rowActionLog.count(), 0);
  });

  /** The loop is not a transaction, so the rows written before a throw must still be audited. */
  it('records the rows it did write when the commit throws partway through the loop', async () => {
    await onlineBranch();
    let writes = 0;
    const failingOnTheThird = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== 'student') return Reflect.get(target, key) as unknown;
        return new Proxy(target.student, {
          get(delegate, method: string | symbol) {
            if (method !== 'create') return Reflect.get(delegate, method) as unknown;
            return (args: Parameters<typeof delegate.create>[0]) => {
              writes += 1;
              if (writes > 2) return Promise.reject(new Error('student write failed'));
              return delegate.create(args);
            };
          },
        });
      },
    });

    await assert.rejects(
      () =>
        importsOn(failingOnTheThird).commitStudents(
          Buffer.from(roster('mobile\n9000000001\n9000000002\n9000000003')),
          ADMIN,
        ),
      /student write failed/,
    );

    const students = await prisma.student.findMany({ select: { id: true } });
    assert.equal(students.length, 2);
    assert.deepEqual(
      (await rowActions()).map((row) => [row.entityId, row.action]).sort(),
      students.map((student) => [student.id, AUDIT_ACTION.CREATE]).sort(),
    );
    const [log] = await importLogs();
    assert.equal(log?.status, IMPORT_LOG_STATUS.FAILED);
    assert.deepEqual([log?.created, log?.updated, log?.failed], [2, 0, 1]);
  });

  /** By the time the audit write runs the students are durable: losing the trail never relabels the commit. */
  it('ends COMMITTED with the student write intact even when recordImportRows throws', async () => {
    await onlineBranch();
    const throwingAudit = {
      recordImportRows: () => Promise.reject(new Error('audit db unreachable')),
    } as unknown as AuditService;

    const result = await importsOn(prisma, { audit: throwingAudit }).commitStudents(
      Buffer.from(roster('mobile\n9876543210')),
      ADMIN,
    );

    assert.equal(result.created, 1);
    assert.ok(await prisma.student.findFirst({ where: { mobile: '9876543210' } }));
    const [log] = await importLogs();
    assert.deepEqual([log?.status, log?.created], [IMPORT_LOG_STATUS.COMMITTED, 1]);
    // The audit write never landed — that is the cost, not a lie about the import.
    assert.equal(await prisma.rowActionLog.count(), 0);
  });
});

describe('ImportsService — a run whose file never reached storage', () => {
  /** The failure this prevents: an eternally PREVIEWED run with a null key and no finishedAt. */
  it('closes the run FAILED when the upload throws, and writes no student', async () => {
    await onlineBranch();
    const storage = new FakeStorage();
    storage.failNextUpload = true;

    await assert.rejects(
      () =>
        importsOn(prisma, { storage }).commitStudents(
          Buffer.from(roster('mobile\n9876543210')),
          ADMIN,
        ),
      /s3 is down/,
    );

    const [log, ...others] = await importLogs();
    assert.equal(others.length, 0);
    assert.equal(log?.status, IMPORT_LOG_STATUS.FAILED);
    assert.equal(log?.fileS3Key, null);
    assert.ok(log?.finishedAt, 'the run is closed, not left in progress');
    assert.equal(log?.failed, 1, 'the row the abort never reached');
    assert.equal(await prisma.student.count(), 0);
  });
});

/** The same roster as a real workbook, so the stored key is chosen from the bytes and not the name. */
async function rosterWorkbook(csv: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  for (const line of roster(csv).split('\n')) sheet.addRow(line.split(','));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ImportsService — the stored sheet keeps the format it arrived in', () => {
  const SUPER_ADMIN = { id: ADMIN, isSuperAdmin: true, isActive: true };

  const storedFile = async (file: Buffer) => {
    await onlineBranch();
    const storage = new FakeStorage();
    await importsOn(prisma, { storage }).commitStudents(file, ADMIN);
    const [log] = await importLogs();
    return {
      key: log?.fileS3Key ?? '',
      ...(await new AuditService(prisma, storage as never).importFile(log?.id ?? '', SUPER_ADMIN)),
    };
  };

  /** The failure this prevents: a CSV roster downloading from the audit list named .xlsx. */
  it('stores a CSV roster under a .csv key and hands it back as a CSV', async () => {
    const file = await storedFile(Buffer.from(roster('mobile\n9876543210')));

    assert.ok(file.key.endsWith('.csv'), file.key);
    assert.ok(file.filename.endsWith('.csv'), file.filename);
    assert.equal(file.contentType, 'text/csv');
  });

  it('stores a workbook roster under a .xlsx key and hands it back as a workbook', async () => {
    const file = await storedFile(await rosterWorkbook('mobile\n9876543210'));

    assert.ok(file.key.endsWith('.xlsx'), file.key);
    assert.ok(file.filename.endsWith('.xlsx'), file.filename);
    assert.equal(file.contentType, XLSX_CONTENT_TYPE);
  });
});

describe('ImportsService.commitProgramStudents — the run and the response count the same rows', () => {
  /** The failure this prevents: a file of already-enrolled rows reading 1 skipped on screen and 5 in the audit. */
  it('counts an already-enrolled row and an unusable row alike, on both sides', async () => {
    const program = 'SSC FOUNDATION';
    await makeStudent(prisma, { mobile: '9000000001', programs: [program] });

    const result = await importsOn().commitProgramStudents(
      program,
      Buffer.from('mobile,full_name\n9000000001,Already\nnot-a-number,Bad'),
      ADMIN,
    );

    const [log] = await importLogs();
    assert.deepEqual(
      [result.alreadyEnrolled, result.invalid, result.enrolled, result.skipped],
      [1, 1, 0, 2],
    );
    assert.deepEqual([log?.total, log?.skipped, log?.failed], [2, 2, 0]);
  });
});

describe('ImportsService.commitStudents — a re-import adds access, never takes it', () => {
  /** The failure this prevents: last term's sheet, uploaded again with a blank Programs cell, wiping the programs added since. */
  it('keeps what a student already holds and adds what the row brings', async () => {
    await onlineBranch();
    const existing = await makeStudent(prisma, {
      mobile: '9000000001',
      programs: ['SSC FOUNDATION'],
      enrolledCourses: ['RRB'],
      enrolledExams: ['SSC CGL'],
    });

    await importsOn(prisma).commitStudents(Buffer.from(roster('mobile\n9000000001')), ADMIN);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: existing.id } });
    assert.deepEqual(row.programs, ['SSC FOUNDATION']);
    assert.deepEqual([...row.enrolledCourses].sort(), ['RRB', 'SSC']);
    assert.deepEqual(row.enrolledExams, ['SSC CGL']);
  });
});

describe('ImportsService — a failed close preserves what openRun already recorded', () => {
  /** `plan.fileErrors` is only non-empty when nothing is left to write, so this is reached directly. */
  it('keeps the fileErrors recorded at open alongside the failure message', async () => {
    const fileErrors = ['Missing the "Mobile Number" column'];
    const opened = await prisma.importLog.create({
      data: {
        feature: AUDIT_FEATURE.STUDENT,
        source: IMPORT_SOURCE.SHEET,
        actorId: ADMIN,
        total: 0,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: { fileErrors },
      },
    });

    await (importsOn() as unknown as ImportsServiceInternals).closeRun(
      opened.id,
      IMPORT_LOG_STATUS.FAILED,
      { rowActions: [], counts: { created: 0, updated: 0, skipped: 0, failed: 0 } },
      ADMIN,
      { fileErrors, error: new Error('db exploded') },
    );

    const failed = await prisma.importLog.findUniqueOrThrow({ where: { id: opened.id } });
    const errors = failed.errors as { fileErrors?: string[]; message: string };
    assert.equal(failed.status, IMPORT_LOG_STATUS.FAILED);
    assert.deepEqual(errors.fileErrors, fileErrors);
    assert.equal(errors.message, 'db exploded');
  });
});

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

/** Previews the sheet and commits the run it opened. */
async function importQuestions(...stems: string[]) {
  await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
  const service = new QuestionImportService(
    prisma,
    new FakeStorage() as never,
    new AuditService(prisma, new FakeStorage() as never),
  );
  await service.preview(questionSheet(...stems), ADMIN);
  const [log] = await importLogs();
  const result = await service.commit(log?.id ?? '', { actorId: ADMIN });
  return { logId: log?.id ?? '', result };
}

describe('QuestionImportService — recognising what the bank already holds', () => {
  /** The dedup read is scoped to this sheet's own hashes, so it must still find the bank's copy. */
  it('skips a stem already in the bank rather than importing it twice', async () => {
    const stem = 'What is 20% of 150?';
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const service = new QuestionImportService(
      prisma,
      new FakeStorage() as never,
      new AuditService(prisma, new FakeStorage() as never),
    );
    const run = async (...stems: string[]) => {
      await service.preview(questionSheet(...stems), ADMIN);
      const logs = await importLogs();
      return service.commit(logs[logs.length - 1]?.id ?? '', { actorId: ADMIN });
    };
    assert.equal((await run(stem)).created, 1);

    const again = await run(stem, 'What is 30% of 200?');

    assert.equal(again.created, 1, 'only the new stem is written');
    assert.equal(await prisma.question.count(), 2);
  });
});

describe('QuestionImportService.commit — the rows a question sheet leaves behind', () => {
  /** The failure this prevents: a thousand-question import nothing in the Activity tab can trace back. */
  it('writes one audit row per created question, pointing at the run, with no diff', async () => {
    const { logId, result } = await importQuestions('What is 20% of 150?', 'What is 30% of 200?');

    assert.equal(result.created, 2);
    const questions = await prisma.question.findMany({ select: { id: true } });
    assert.deepEqual(
      (await rowActions())
        .map((row) => [
          row.entityId,
          row.action,
          row.feature,
          row.importLogId,
          row.actorId,
          row.changed,
        ])
        .sort(),
      questions
        .map((question) => [
          question.id,
          AUDIT_ACTION.CREATE,
          AUDIT_FEATURE.QUESTION,
          logId,
          ADMIN,
          null,
        ])
        .sort(),
    );
  });
});

describe('QuestionImportService.commit — the status the rows land in', () => {
  it('puts every imported row straight into the bank', async () => {
    await importQuestions('What is 20% of 150?', 'What is 30% of 200?');

    const statuses = await prisma.question.findMany({ select: { status: true } });
    assert.deepEqual(
      statuses.map((row) => row.status),
      [QUESTION_STATUS.ACTIVE, QUESTION_STATUS.ACTIVE],
    );
  });
});

/** A 1×1 PNG: the smallest bytes the image sniffer accepts. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** One question whose second option is only a picture, floated over that cell as an exporter leaves it. */
async function pictureSheet(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Questions');
  const row = { ...QUESTION_ROW, stem_en: 'Which figure comes next?', option2_en: '' };
  sheet.addRow(QUESTION_IMPORT_COLUMNS.map((column) => column.header));
  sheet.addRow(
    QUESTION_IMPORT_COLUMNS.map((column) => row[column.key as QuestionImportColumnKey] ?? ''),
  );
  const option2 = QUESTION_IMPORT_COLUMNS.findIndex((column) => column.key === 'option2_en');
  const image = workbook.addImage({ buffer: PNG as never, extension: 'png' });
  sheet.addImage(image, { tl: { col: option2, row: 1 }, ext: { width: 20, height: 20 } });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('QuestionImportService — pictures placed over the sheet', () => {
  const picturesIn = (storage: FakeStorage) =>
    [...storage.objects.keys()].filter((key) => key.startsWith('questions/images/'));

  it('stores the picture at preview, so the review window can draw it, and the question points at it', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const storage = new FakeStorage();
    const service = new QuestionImportService(
      prisma,
      storage as never,
      new AuditService(prisma, new FakeStorage() as never),
    );

    const plan = await service.preview(await pictureSheet(), ADMIN);
    assert.equal(plan.summary.willCreate, 1);
    assert.equal(picturesIn(storage).length, 1, 'the preview stores the picture');

    assert.equal((await service.commit(plan.importLogId, { actorId: ADMIN })).created, 1);
    const [stored] = picturesIn(storage);
    const version = await prisma.questionVersion.findFirstOrThrow();
    assert.ok(stored && JSON.stringify(version.options).includes(stored));
  });

  /** The failure this prevents: every re-upload of a sheet with pictures writing its questions again. */
  it('recognises the same sheet uploaded again as duplicates', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const service = new QuestionImportService(
      prisma,
      new FakeStorage() as never,
      new AuditService(prisma, new FakeStorage() as never),
    );
    const run = async () => {
      const plan = await service.preview(await pictureSheet(), ADMIN);
      return service.commit(plan.importLogId, { actorId: ADMIN });
    };
    assert.equal((await run()).created, 1);

    const again = await run();

    assert.equal(again.created, 0);
    assert.equal(await prisma.question.count(), 1);
  });
});
