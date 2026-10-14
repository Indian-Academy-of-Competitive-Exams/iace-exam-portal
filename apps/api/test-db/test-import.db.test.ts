import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  PAPER_SOURCES,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_SECTION_COLUMN,
  QUESTION_VALIDATION_CODE,
  type PaperSource,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { QuestionImportService } from '../src/questions/question-import.service';
import { FakeStorage } from '../test/support/fakes';
import {
  makeCatalog,
  makeQuestionBank,
  makeSection,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';

const OWNER = randomUUID();
const TYPIST = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const COLUMNS = [QUESTION_IMPORT_SECTION_COLUMN, ...QUESTION_IMPORT_COLUMNS];

/** A whole-test sheet as CSV: each row names its section and asks a question nobody else asks. */
function sheetOf(...rows: { section: string; stem: string }[]): Buffer {
  const cells = (pick: (column: (typeof COLUMNS)[number]) => string) => COLUMNS.map(pick).join(',');
  const lines = rows.map(({ section, stem }) => {
    const row: Partial<Record<QuestionImportColumnKey | 'section', string>> = {
      section,
      subject: 'Quantitative Aptitude',
      difficulty: 'medium',
      stem_en: stem,
      option1_en: '25',
      option2_en: '45',
      option3_en: '35',
      option4_en: '40',
      correct_option: '2',
    };
    return cells((column) => row[column.key] ?? '');
  });
  return Buffer.from([cells((column) => column.header), ...lines].join('\n'));
}

const asked = (section: string, count: number, from = 1) =>
  Array.from({ length: count }, (_, at) => ({ section, stem: `What is ${from + at}% of 9731?` }));

/** A typed test of two sections, Quant (3 questions) with a typist and Reasoning with none. */
async function aTest(source: PaperSource = PAPER_SOURCES.FRAMED) {
  await makeQuestionBank(prisma, { [OWNER]: 'Owner', [TYPIST]: 'Anita' });
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog, { paperSource: source });
  const quant = await makeSection(prisma, catalog, { name: 'Quant', order: 1 });
  await prisma.baseConfigSection.update({ where: { id: quant.id }, data: { questionCount: 3 } });
  await makeSection(prisma, catalog, { name: 'Reasoning', order: 2 });
  const typing = await prisma.questionAssignment.create({
    data: {
      testId: test.id,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId: quant.id,
      assigneeId: TYPIST,
      role: ASSIGNMENT_ROLES.TYPIST,
    },
  });
  const storage = new FakeStorage() as never;
  const imports = new QuestionImportService(prisma, storage, new AuditService(prisma, storage));
  const into = { testId: test.id, wholeTest: true as const };
  const run = async (sheet: Buffer) => {
    const plan = await imports.preview(sheet, OWNER, into);
    return { plan, commit: () => imports.commit(plan.importLogId, { actorId: OWNER, test: into }) };
  };
  const drafts = () => prisma.question.count({ where: { assignmentId: typing.id } });
  return { test, imports, into, run, drafts };
}

describe('QuestionImportService — a whole typed test in one sheet', () => {
  /** THE failure this prevents: leftover rows saved to the bank as if they came in for this test. */
  it('writes each row as its section typist’s draft, up to the count, and saves no leftover', async () => {
    const { run, drafts } = await aTest();
    const before = await prisma.question.count();

    const { plan, commit } = await run(sheetOf(...asked('Quant', 4), ...asked('Reasoning', 1, 50)));

    assert.deepEqual(
      plan.rows.map((row) => row.issues[0]?.code ?? row.action),
      [
        'create',
        'create',
        'create',
        QUESTION_VALIDATION_CODE.SECTION_FULL,
        QUESTION_VALIDATION_CODE.SECTION_NOT_OPEN,
      ],
    );
    assert.equal((await commit()).created, 3);
    assert.equal(await drafts(), 3);
    assert.equal((await prisma.question.count()) - before, 3);
  });

  /** THE failure this prevents: a second upload of the same rows taking the room a new one needed. */
  it('adds a second upload to the first, and a row already imported takes no room', async () => {
    const { run, drafts } = await aTest();
    await (await run(sheetOf(...asked('Quant', 2)))).commit();

    const again = await run(sheetOf(...asked('Quant', 2), ...asked('Quant', 2, 20)));

    assert.deepEqual(
      again.plan.rows.map((row) => row.issues[0]?.code ?? row.action),
      ['duplicate', 'duplicate', 'create', QUESTION_VALIDATION_CODE.SECTION_FULL],
    );
    await again.commit();
    assert.equal(await drafts(), 3);
  });

  it('refuses a picked test', async () => {
    const picked = await aTest(PAPER_SOURCES.PICKED);
    await assert.rejects(
      () => picked.run(sheetOf(...asked('Quant', 1))),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('refuses an offered typed test', async () => {
    const { run, test } = await aTest();
    await prisma.test.update({ where: { id: test.id }, data: { finalizedAt: new Date() } });

    await assert.rejects(
      () => run(sheetOf(...asked('Quant', 1))),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });
});
