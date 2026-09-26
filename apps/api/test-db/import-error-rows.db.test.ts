import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'reflect-metadata';
import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import ExcelJS from 'exceljs';
import {
  ActorTypes,
  BRANCH_TYPE,
  ErrorCodes,
  FEATURE_KEYS,
  IMPORT_FILE_FIELD,
  IMPORT_ROUTES,
  PERMISSION_LEVELS,
  QUESTION_IMPORT_ROUTES,
} from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { type AuthenticatedUser } from '../src/common/security';
import { ImportsController } from '../src/imports/imports.controller';
import { ImportsService } from '../src/imports/imports.service';
import { QuestionImportController } from '../src/questions/question-import.controller';
import { QuestionImportService } from '../src/questions/question-import.service';
import {
  FakeEventsService,
  FakeProgramsService,
  FakeStorage,
  fakeStartingPins,
  roster,
} from '../test/support/fakes';
import { makeAdmin, makeQuestionBank, resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();
const audit = new AuditService(prisma, new FakeStorage() as never);
const imports = new ImportsService(
  prisma,
  fakeStartingPins(),
  new FakeStorage() as never,
  audit,
  new FakeEventsService().asService(),
  new FakeProgramsService().asService(),
);
const questionImports = new QuestionImportService(prisma, new FakeStorage() as never, audit);

/** tsx emits no decorator metadata, so Nest cannot inject by type; the routes are inherited whole. */
class StudentRoutes extends ImportsController {
  constructor() {
    super(imports);
  }
}
class QuestionRoutes extends QuestionImportController {
  constructor() {
    super(questionImports);
  }
}

let caller: AuthenticatedUser;

@Module({
  controllers: [StudentRoutes, QuestionRoutes],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
class ImportModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((request: { user?: AuthenticatedUser }, _response: unknown, next: () => void) => {
        request.user = caller;
        next();
      })
      .forRoutes('*');
  }
}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(ImportModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.branch.create({ data: { name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL } });
  await makeQuestionBank(prisma);
  const { id } = await makeAdmin(prisma);
  caller = {
    id,
    actor: ActorTypes.ADMIN,
    sessionId: uid(),
    isSuperAdmin: false,
    isActive: true,
    permissions: {
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.READ,
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.READ,
    },
  };
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

function post(path: string, file: Buffer | Uint8Array, name = 'upload.csv'): Promise<Response> {
  const form = new FormData();
  form.append(IMPORT_FILE_FIELD, new Blob([file]), name);
  return fetch(`${baseUrl}${path}`, { method: 'POST', body: form });
}

async function workbookOf(response: Response): Promise<ExcelJS.Workbook> {
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
}

function cellsOf(workbook: ExcelJS.Workbook): string[][] {
  const rows: string[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map((value) => String(value ?? '')));
  });
  return rows;
}

async function planOf<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200);
  return ((await response.json()) as { data: T }).data;
}

const STUDENTS = roster(
  [
    'Mobile Number,Full Name,Date of Birth',
    '9876500001,Asha,2001-01-01',
    '9876500002,Bala,31/02/99',
    '9876500003,Chitra,2002-02-02',
    '98765,Devi,2003-03-03',
    '9876500005,Esha,2004-04-04',
  ].join('\n'),
);

describe('POST imports/students/errors', () => {
  it('hands back lines 3 and 5 as uploaded, and the corrected file previews clean', async () => {
    const workbook = await workbookOf(
      await post(IMPORT_ROUTES.studentsErrors, Buffer.from(STUDENTS)),
    );
    const rows = cellsOf(workbook);

    assert.deepEqual(rows[0], [
      'Mobile Number',
      'Full Name',
      'Date of Birth',
      'Student Type',
      'Branch Name',
      'Enrolled Courses',
      'Enrolled Exams',
      'Programs',
      'Errors',
    ]);
    assert.deepEqual(
      rows.slice(1).map((row) => row.slice(0, 3)),
      [
        ['9876500002', 'Bala', '31/02/99'],
        ['98765', 'Devi', '2003-03-03'],
      ],
    );
    for (const row of rows.slice(1)) assert.ok(row.at(-1), 'a row came back without its errors');
    assert.equal(await prisma.student.count(), 0);
    assert.equal(await prisma.importLog.count(), 0);

    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    sheet.getCell('C2').value = '1999-02-28';
    sheet.getCell('A3').value = '9876500004';
    const corrected = Buffer.from(await workbook.xlsx.writeBuffer());

    const plan = await planOf<{ summary: { invalid: number; willCreate: number } }>(
      await post(IMPORT_ROUTES.studentsPreview, corrected, 'errors.xlsx'),
    );
    assert.equal(plan.summary.invalid, 0);
    assert.equal(plan.summary.willCreate, 2);
  });

  it('answers a file-level problem with the message the preview shows for it', async () => {
    const missing = Buffer.from('Full Name\nAsha');
    const plan = await planOf<{ fileErrors: string[] }>(
      await post(IMPORT_ROUTES.studentsPreview, missing),
    );

    const response = await post(IMPORT_ROUTES.studentsErrors, missing);
    const body = (await response.json()) as { error: { code: string; message: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(body.error.message, plan.fileErrors.join(' '));
  });
});

const QUESTION_HEADER =
  'subject,topic,difficulty,stem_en,option1_en,option2_en,option3_en,option4_en,correct_option';
const question = (difficulty: string, stem: string) =>
  `QUANTITATIVE APTITUDE,ARITHMETIC,${difficulty},${stem},25,30,35,40,2`;

describe('POST imports/questions/errors', () => {
  it('hands back the failing rows with their messages, and opens no import run', async () => {
    const file = Buffer.from(
      [
        QUESTION_HEADER,
        question('medium', 'What is 20% of 150?'),
        question('impossible', 'What is 10% of 150?'),
        question('low', 'What is 30% of 150?'),
      ].join('\n'),
    );

    const workbook = await workbookOf(await post(QUESTION_IMPORT_ROUTES.errors, file));
    const rows = cellsOf(workbook);

    assert.equal(rows[0]?.at(-1), 'Errors');
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.[2], 'impossible');
    assert.ok(rows[1]?.at(-1));
    assert.equal(await prisma.importLog.count(), 0);

    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    sheet.getCell('C2').value = 'high';
    const plan = await planOf<{ summary: { invalid: number; willCreate: number } }>(
      await post(
        QUESTION_IMPORT_ROUTES.preview,
        Buffer.from(await workbook.xlsx.writeBuffer()),
        'errors.xlsx',
      ),
    );
    assert.deepEqual([plan.summary.invalid, plan.summary.willCreate], [0, 1]);
  });
});
