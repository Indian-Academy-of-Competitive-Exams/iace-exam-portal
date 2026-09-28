import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_TAG,
  type QuestionDraft,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
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

    const result = await imports.commit(importLogId);
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

  it('refuses another admin, as if the run did not exist', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);

    await assert.rejects(
      imports.saveRow(importLogId, 3, fixed(skipped.draft), OTHER_ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses a correction once the run has been imported', async () => {
    const { imports, importLogId } = await previewed();
    const [, skipped] = await imports.drafts(importLogId, ADMIN);
    assert.ok(skipped);
    await imports.commit(importLogId);

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

    const result = await imports.commit(importLogId);
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
