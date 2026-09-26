import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'reflect-metadata';
import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import ExcelJS from 'exceljs';
import {
  ANSWER_MODE,
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  QUESTION_STATUSES,
  QUESTION_TYPE,
  questionDraftSchema,
  questionListQuerySchema,
  type AdminPermissions,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { type AuthenticatedUser } from '../src/common/security';
import { CODE_HEADER, RICH_CONTENT } from '../src/questions/question-export';
import { QuestionImportService } from '../src/questions/question-import.service';
import { QuestionsController } from '../src/questions/questions.controller';
import { QuestionsService } from '../src/questions/questions.service';
import { FakeStorage } from '../test/support/fakes';
import { BANK, makeQuestionBank, resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();
const auditContext = new AuditContext();
const audit = new AuditService(prisma, new FakeStorage() as never);
const questions = new QuestionsService(prisma, auditContext, new FakeStorage() as never);
const importer = new QuestionImportService(prisma, new FakeStorage() as never, audit);

const AUTHOR = uid();
const OTHER_AUTHOR = uid();

let caller: AuthenticatedUser;

/** tsx emits no decorator metadata, so Nest cannot inject by type; the route itself is inherited whole. */
class ExportController extends QuestionsController {
  constructor() {
    super(questions, auditContext);
  }
}

@Module({
  controllers: [ExportController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new AuditInterceptor(reflector, auditContext, audit),
      inject: [Reflector],
    },
  ],
})
class ExportModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    const middleware = new AuditContextMiddleware(auditContext);
    consumer
      .apply((request: { user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
        request.user = caller;
        next();
      }, middleware.use.bind(middleware))
      .forRoutes('*');
  }
}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(ExportModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await makeQuestionBank(prisma, { [AUTHOR]: 'Admin One', [OTHER_AUTHOR]: 'Admin Two' });
  caller = adminWith({
    [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
    [FEATURE_KEYS.DATA_EXPORT]: PERMISSION_LEVELS.READ,
  });
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

function adminWith(permissions: AdminPermissions): AuthenticatedUser {
  return {
    id: AUTHOR,
    actor: ActorTypes.ADMIN,
    sessionId: uid(),
    isSuperAdmin: false,
    isActive: true,
    permissions,
  };
}

type Cell = ExcelJS.CellValue;

async function workbookOf(query: Record<string, string> = {}): Promise<ExcelJS.Workbook> {
  const response = await fetch(
    `${baseUrl}/admin/questions/export?${new URLSearchParams(query).toString()}`,
  );
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
}

function rowsOf(sheet: ExcelJS.Worksheet | undefined): Record<string, Cell>[] {
  const headers = (sheet?.getRow(1).values as Cell[]).slice(1).map(String);
  const rows: Record<string, Cell>[] = [];
  sheet?.eachRow((row, at) => {
    if (at === 1) return;
    const values = row.values as Cell[];
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index + 1]])));
  });
  return rows;
}

const IMAGE = '<img data-key="questions/images/3f2a.png">';
const EQUATION = '<span data-type="inline-math" data-latex="\\frac{a}{b} &lt; 1"></span>';

const options = (texts: string[], correct: number, language = 'en') =>
  texts.map((text, index) => ({
    position: index + 1,
    isCorrect: index + 1 === correct,
    text: { [language]: text },
  }));

const bilingualOptions = (en: string[], hi: string[], correct: number) =>
  options(en, correct).map((option, index) => ({
    ...option,
    text: { en: option.text.en, hi: hi[index] },
  }));

/** One question per Rich content combination, across both types and both answer modes. */
const FIXTURES: { rich: string; draft: QuestionDraftInput }[] = [
  {
    rich: '',
    draft: {
      type: QUESTION_TYPE.SINGLE_MCQ,
      subjectId: BANK.QUANT,
      topicId: BANK.ARITHMETIC,
      difficulty: 'MEDIUM',
      questionCode: 'QA-001',
      stem: { en: '<p>What is 20% of 150?</p><p>Pick one.</p>', hi: '<p>150 का 20% कितना है?</p>' },
      solution: { en: '<p>150 × 0.2 = 30 & done</p>' },
      options: bilingualOptions(['25', '30', '35', '40'], ['२५', '३०', '३५', '४०'], 2),
      tags: ['ssc cgl', 'percentages'],
    },
  },
  {
    rich: RICH_CONTENT.IMAGE,
    draft: {
      type: QUESTION_TYPE.TEXT_FIELD,
      subjectId: BANK.QUANT,
      difficulty: 'LOW',
      stem: { en: `<p>Name the shape ${IMAGE}</p>`, hi: '<p>आकार का नाम बताइए</p>' },
      answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'Triangle', hi: 'त्रिभुज' } },
      tags: ['geometry'],
    },
  },
  {
    rich: RICH_CONTENT.EQUATION,
    draft: {
      type: QUESTION_TYPE.TEXT_FIELD,
      subjectId: BANK.QUANT,
      topicId: BANK.ALGEBRA,
      difficulty: 'HIGH',
      stem: { en: `<p>Solve ${EQUATION} for the largest a when b = 4</p>` },
      answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: '3.99' }, tolerance: 0.01 },
    },
  },
  {
    rich: `${RICH_CONTENT.IMAGE}, ${RICH_CONTENT.EQUATION}`,
    draft: {
      type: QUESTION_TYPE.SINGLE_MCQ,
      subjectId: BANK.QUANT,
      difficulty: 'MEDIUM',
      stem: { en: `<p>Read the figure ${IMAGE}</p><p>then ${EQUATION}</p>` },
      options: options(['One', 'Two', 'Three', 'Four'], 4),
      tags: ['figures'],
    },
  },
];

async function seedFixtures(): Promise<string[]> {
  const ids: string[] = [];
  for (const { draft } of FIXTURES) {
    ids.push((await questions.create(questionDraftSchema.parse(draft), AUTHOR)).id);
  }
  return ids;
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('GET admin/questions/export', () => {
  it('writes a sheet the question importer re-plans as every row a duplicate, with no issues', async () => {
    const ids = await seedFixtures();

    const workbook = await workbookOf();
    const plan = await importer.preview(await toBuffer(workbook), AUTHOR);

    assert.deepEqual(plan.fileErrors, []);
    assert.equal(plan.summary.total, FIXTURES.length);
    assert.equal(plan.summary.duplicates, FIXTURES.length);
    for (const row of plan.rows) assert.deepEqual(row.issues, []);
    assert.deepEqual(plan.rows.map((row) => row.duplicateOf).sort(), [...ids].sort());
  });

  it('writes Rich content for every combination, and the code only in its read-only column', async () => {
    const ids = await seedFixtures();

    const rows = rowsOf((await workbookOf()).getWorksheet('Questions'));
    const rich = rows.map((row) => row['Rich content'] ?? '').sort();

    assert.equal(rows.length, ids.length);
    assert.deepEqual(rich, FIXTURES.map((fixture) => fixture.rich).sort());
    const coded = rows.find((row) => row[CODE_HEADER] === 'QA-001');
    assert.equal(coded?.question_code ?? null, null);
    assert.deepEqual(
      rows.filter((row) => row !== coded).map((row) => row[CODE_HEADER] ?? null),
      [null, null, null],
    );
    const withImage = rows.find((row) => row['Rich content'] === RICH_CONTENT.IMAGE);
    assert.match(String(withImage?.stem_en), /questions\/images\/3f2a\.png/);
    const withEquation = rows.find((row) => row['Rich content'] === RICH_CONTENT.EQUATION);
    assert.match(String(withEquation?.stem_en), /\\frac\{a\}\{b\} < 1/);
  });

  it('re-plans a coded row whose stem was edited as a clean create, the rest as duplicates', async () => {
    await seedFixtures();
    const workbook = await workbookOf();
    const sheet = workbook.getWorksheet('Questions');
    const stemColumn = (sheet?.getRow(1).values as Cell[]).indexOf('stem_en');
    let edited = 0;
    sheet?.eachRow((row, at) => {
      if (at === 1 || edited > 0 || !String(row.getCell(stemColumn).value).startsWith('What'))
        return;
      row.getCell(stemColumn).value = 'What is 25% of 160?';
      edited = at;
    });

    const plan = await importer.preview(await toBuffer(workbook), AUTHOR);

    assert.equal(plan.summary.willCreate, 1);
    assert.equal(plan.summary.duplicates, FIXTURES.length - 1);
    const editedRow = plan.rows.find((row) => row.line === edited);
    assert.equal(editedRow?.action, 'create');
    assert.deepEqual(editedRow?.issues, []);
  });

  it('writes the rows the list counts for a date range and an author, Created on the IST clock', async () => {
    const [inRange, outOfRange, otherAuthor] = await seedFixtures();
    // 20:00 UTC on the 9th is 01:30 on the 10th in Asia/Kolkata.
    const lateNight = new Date('2026-01-09T20:00:00.000Z');
    await prisma.question.update({ where: { id: inRange }, data: { createdAt: lateNight } });
    await prisma.question.update({
      where: { id: outOfRange },
      data: { createdAt: new Date('2026-01-09T10:00:00.000Z') },
    });
    await prisma.question.update({
      where: { id: otherAuthor },
      data: { createdAt: lateNight, createdById: OTHER_AUTHOR },
    });
    const query = { from: '2026-01-10', to: '2026-01-10', author: 'Admin One' };

    const rows = rowsOf((await workbookOf(query)).getWorksheet('Questions'));
    const { total } = await questions.list(questionListQuerySchema.parse(query));

    assert.equal(total, 1);
    assert.equal(rows.length, total);
    assert.equal(rows[0]?.Author, 'Admin One');
    assert.deepEqual(rows[0]?.Created, new Date('2026-01-10T01:30:00.000Z'));
  });

  it('counts the authoring summary per author and status, as a direct count does', async () => {
    const ids = await seedFixtures();
    await prisma.question.updateMany({
      where: { id: { in: ids.slice(0, 2) } },
      data: { createdById: OTHER_AUTHOR },
    });
    await prisma.question.update({
      where: { id: ids[3] },
      data: { status: QUESTION_STATUS.ARCHIVED },
    });

    const summary = rowsOf(
      (await workbookOf({ status: QUESTION_STATUSES.join(',') })).getWorksheet('Authoring summary'),
    );

    assert.equal(summary.length, 2);
    for (const [id, name] of [
      [AUTHOR, 'Admin One'],
      [OTHER_AUTHOR, 'Admin Two'],
    ] as const) {
      const row = summary.find((candidate) => candidate.Author === name);
      for (const status of QUESTION_STATUSES) {
        const direct = await prisma.question.count({ where: { createdById: id, status } });
        assert.equal(row?.[status] ?? 0, direct, `${name} ${status}`);
      }
    }
  });
});
