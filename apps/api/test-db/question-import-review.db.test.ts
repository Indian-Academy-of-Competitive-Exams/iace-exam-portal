import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { type Prisma } from '@prisma/client';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  IMPORT_LOG_STATUS,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_TAG,
  type QuestionDraft,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import type { AuthenticatedUser } from '../src/common/security';
import { type PrismaService } from '../src/prisma/prisma.service';
import { QuestionImportController } from '../src/questions/question-import.controller';
import { QuestionImportService } from '../src/questions/question-import.service';
import { FakeStorage } from '../test/support/fakes';
import { BANK, makeQuestionBank, resetDatabase, testPrisma } from './support/database';

const ADMIN = randomUUID();
const OTHER_ADMIN = randomUUID();
const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** No commas anywhere: the sheet is written out as CSV. */
const ROW: Partial<Record<QuestionImportColumnKey, string>> = {
  subject: 'Quantitative Aptitude',
  difficulty: 'medium',
  stem_en: 'What is 20% of 150?',
  option1_en: '25',
  option2_en: '30',
  option3_en: '35',
  option4_en: '40',
  correct_option: '2',
};

function sheet(...rows: Partial<Record<QuestionImportColumnKey, string>>[]): Buffer {
  const header = QUESTION_IMPORT_COLUMNS.map((column) => column.header).join(',');
  const lines = rows.map((row) =>
    QUESTION_IMPORT_COLUMNS.map((column) => row[column.key as QuestionImportColumnKey] ?? '').join(
      ',',
    ),
  );
  return Buffer.from([header, ...lines].join('\n'));
}

const service = () =>
  new QuestionImportService(
    prisma,
    new FakeStorage() as never,
    new AuditService(prisma, new FakeStorage() as never),
  );

/** The question write inside the commit throws, the way a dropped connection would. */
function failingOnWrite(): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) => {
          const table = new Proxy(tx.question, {
            get(delegate, method: string | symbol) {
              if (method !== 'create') return Reflect.get(delegate, method) as unknown;
              return () => Promise.reject(new Error('connection dropped'));
            },
          });
          return work(
            new Proxy(tx, {
              get: (inner, member: string | symbol) =>
                member === 'question' ? table : (Reflect.get(inner, member) as unknown),
            }),
          );
        });
    },
  });
}

/** A good row, and on line 3 the same question with no correct answer marked. */
async function previewed() {
  await makeQuestionBank(prisma, { [ADMIN]: 'Admin One', [OTHER_ADMIN]: 'Admin Two' });
  const imports = service();
  const plan = await imports.preview(
    sheet(ROW, { ...ROW, stem_en: 'What is 10% of 150?', correct_option: '' }),
    ADMIN,
  );
  return { imports, importLogId: plan.importLogId };
}

const fixed = (draft: QuestionDraft): QuestionDraft => ({
  ...draft,
  options: draft.options.map((option) => ({ ...option, isCorrect: option.position === 4 })),
});

describe('QuestionImportService — correcting a previewed row', () => {
  it('opens every row as a question, a Skip row included', async () => {
    const { imports, importLogId } = await previewed();

    const drafts = await imports.drafts(importLogId, ADMIN);

    assert.deepEqual(
      drafts.map((row) => row.line),
      [2, 3],
    );
    assert.equal(drafts[1]?.draft.subjectId, BANK.QUANT);
  });

  /** The failure this prevents: a row the admin fixed on screen still skipped at Import. */
  it('turns a fixed Skip row into Create, and Import writes it as corrected', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);

    const plan = await imports.saveRow(importLogId, 3, fixed(skipped.draft), ADMIN);
    assert.equal(plan.rows.find((row) => row.line === 3)?.action, 'create');
    assert.equal(plan.rows.find((row) => row.line === 3)?.edited, true);

    const result = await imports.commit(importLogId, { actorId: ADMIN });
    assert.equal(result.created, 2);
    const written = await prisma.question.findFirstOrThrow({
      where: {
        currentVersion: { content: { path: ['en', 'stem', '0', 'text'], string_contains: '10%' } },
      },
      select: { tags: true, currentVersion: { select: { options: true } } },
    });
    assert.ok(written.tags.includes(QUESTION_IMPORT_TAG), 'a correction keeps the import tag');
    const options = written.currentVersion?.options as { position: number; isCorrect: boolean }[];
    assert.equal(options.find((option) => option.isCorrect)?.position, 4);
  });

  it('judges a correction against the rest of the sheet, as a duplicate of an earlier line', async () => {
    const { imports, importLogId } = await previewed();
    const [first, second] = await imports.drafts(importLogId, ADMIN);
    assert.ok(first, 'the first line has a draft');
    assert.ok(second, 'the second line has a draft');

    const plan = await imports.saveRow(importLogId, 3, first.draft, ADMIN);

    assert.equal(plan.rows.find((row) => row.line === 3)?.action, 'duplicate');
  });

  /** The failure this prevents: either key reaches these routes, so the run itself is the fence. */
  it('refuses another admin, as if the run did not exist', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);
    const notFound = (error: unknown) =>
      AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

    await assert.rejects(imports.drafts(importLogId, OTHER_ADMIN), notFound);
    await assert.rejects(
      imports.saveRow(importLogId, 3, fixed(skipped.draft), OTHER_ADMIN),
      notFound,
    );
    await assert.rejects(imports.leaveOutRow(importLogId, 3, true, OTHER_ADMIN), notFound);
  });

  /** The failure this prevents: an admin, a super admin included, committing a run somebody else previewed. */
  it('commits a bank run for the admin who previewed it and nobody else', async () => {
    const { imports, importLogId } = await previewed();
    const route = new QuestionImportController(imports);
    const admin = (id: string, isSuperAdmin: boolean): AuthenticatedUser => ({
      id,
      actor: ActorTypes.ADMIN,
      sessionId: randomUUID(),
      isSuperAdmin,
      isActive: true,
      permissions: {},
    });

    await assert.rejects(
      route.commit({ importLogId }, admin(OTHER_ADMIN, true)),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
    assert.equal(await prisma.question.count(), 0);

    const result = await route.commit({ importLogId }, admin(ADMIN, false));
    assert.equal(result.created, 1);
  });

  it('refuses a correction once the run has been imported', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);
    await imports.commit(importLogId, { actorId: ADMIN });

    await assert.rejects(
      imports.saveRow(importLogId, 3, fixed(skipped.draft), ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('refuses a line the file does not have', async () => {
    const { imports, importLogId } = await previewed();
    const [first] = await imports.drafts(importLogId, ADMIN);
    assert.ok(first);

    await assert.rejects(
      imports.saveRow(importLogId, 99, first.draft, ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('QuestionImportService — leaving a previewed row out', () => {
  it('writes nothing for a row left out, and Import skips it', async () => {
    const { imports, importLogId } = await previewed();

    const plan = await imports.leaveOutRow(importLogId, 2, true, ADMIN);
    assert.equal(plan.rows.find((row) => row.line === 2)?.action, 'left_out');
    assert.equal(plan.summary.leftOut, 1);

    const result = await imports.commit(importLogId, { actorId: ADMIN });
    assert.equal(result.created, 0);
    assert.equal(await prisma.question.count(), 0);
  });

  /** The failure this prevents: bringing a corrected row back and importing it as the sheet had it. */
  it('brings a corrected row back with its correction', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);
    await imports.saveRow(importLogId, 3, fixed(skipped.draft), ADMIN);
    await imports.leaveOutRow(importLogId, 3, true, ADMIN);

    const plan = await imports.leaveOutRow(importLogId, 3, false, ADMIN);

    const row = plan.rows.find((one) => one.line === 3);
    assert.equal(row?.action, 'create');
    assert.equal(row?.edited, true);
  });

  it('refuses another admin, as if the run did not exist', async () => {
    const { imports, importLogId } = await previewed();

    await assert.rejects(
      imports.leaveOutRow(importLogId, 2, true, OTHER_ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('QuestionImportService — what a run counts', () => {
  /** The failure this prevents: a sheet of 1 create and 2 unanswered rows reading 2 skipped on screen and 0 skipped / 2 failed in the audit. */
  it('files every row it chose not to write as skipped, and nothing as failed', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const imports = service();
    const plan = await imports.preview(
      sheet(
        ROW,
        { ...ROW, stem_en: 'What is 10% of 150?', correct_option: '' },
        { ...ROW, stem_en: 'What is 30% of 150?', correct_option: '' },
      ),
      ADMIN,
    );

    const result = await imports.commit(plan.importLogId, { actorId: ADMIN });

    assert.deepEqual(
      { created: result.created, skipped: result.skipped },
      { created: 1, skipped: 2 },
    );
    const log = await prisma.importLog.findUniqueOrThrow({ where: { id: plan.importLogId } });
    assert.deepEqual(
      { created: log.created, skipped: log.skipped, failed: log.failed },
      { created: 1, skipped: 2, failed: 0 },
    );
  });

  /** The failure this prevents: a commit that died leaving its run PREVIEWED, so the audit list shows it in progress for ever. */
  it('closes a run FAILED when the question write throws', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const storage = new FakeStorage();
    const audit = new AuditService(prisma, new FakeStorage() as never);
    const plan = await new QuestionImportService(prisma, storage as never, audit).preview(
      sheet(ROW),
      ADMIN,
    );

    const dying = new QuestionImportService(failingOnWrite(), storage as never, audit);
    await assert.rejects(dying.commit(plan.importLogId, { actorId: ADMIN }), /connection dropped/);

    const log = await prisma.importLog.findUniqueOrThrow({ where: { id: plan.importLogId } });
    assert.equal(log.status, IMPORT_LOG_STATUS.FAILED);
    assert.ok(log.finishedAt, 'a closed run carries when it ended');
    assert.deepEqual({ created: log.created, failed: log.failed }, { created: 0, failed: 1 });
    assert.equal(await prisma.question.count(), 0);
  });
});

describe('QuestionImportService — a file nothing can be planned from', () => {
  /** The failure this prevents: a header-only sheet, or one with no Subject column, leaving a total-0 run row and a sheet in storage nothing ever cleans up. */
  it('opens no run and stores nothing', async () => {
    await makeQuestionBank(prisma, { [ADMIN]: 'Admin One' });
    const storage = new FakeStorage();
    const imports = new QuestionImportService(
      prisma,
      storage as never,
      new AuditService(prisma, new FakeStorage() as never),
    );

    const empty = await imports.preview(sheet(), ADMIN);
    assert.deepEqual(empty.fileErrors, ['That file has no question rows']);

    const noSubject = await imports.preview(Buffer.from('Difficulty\nmedium'), ADMIN);
    assert.ok(noSubject.fileErrors.includes('The column "Subject" is missing'));

    assert.equal(await prisma.importLog.count(), 0);
    assert.equal(storage.objects.size, 0);
  });
});
