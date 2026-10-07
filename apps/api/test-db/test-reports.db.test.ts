import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'reflect-metadata';
import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import ExcelJS from 'exceljs';
import {
  ATTEMPT_STATUS,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  AppException,
  ErrorCodes,
  MERIT_TYPE,
  REPORT_KEYS,
  TEST_SERIES_KIND,
} from '@iace/contracts';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { packedSections } from '../src/attempts/score-paper';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { ReportsController } from '../src/reports/reports.controller';
import { FakeStorage } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeAdmin,
  makeBranch,
  makeCatalog,
  makePaper,
  makeSection,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
  type Catalog,
} from './support/database';
import { SUPER_ADMIN, VIEWER, figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();

const { reports, read } = reportsOver(prisma);
const auditContext = new AuditContext();

/** tsx emits no decorator metadata, so Nest cannot inject by type; the routes are inherited whole. */
class Controller extends ReportsController {
  constructor() {
    super(reports, auditContext);
  }
}

@Module({
  controllers: [Controller],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) =>
        new AuditInterceptor(
          reflector,
          auditContext,
          new AuditService(prisma, new FakeStorage() as never),
        ),
      inject: [Reflector],
    },
  ],
})
class ReportsTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    const middleware = new AuditContextMiddleware(auditContext);
    consumer
      .apply((request: { user?: unknown }, _response: unknown, next: () => void) => {
        request.user = { ...VIEWER, permissions: {}, actor: ActorTypes.ADMIN, sessionId: uid() };
        next();
      }, middleware.use.bind(middleware))
      .forRoutes('*');
  }
}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(ReportsTestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
beforeEach(() => resetDatabase(prisma));
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** A FREE series reaches every live student, so who a test reaches is plain to read. */
async function freeTest(): Promise<{ catalog: Catalog; testId: string }> {
  const catalog = await makeCatalog(prisma);
  await makeFree(catalog);
  return { catalog, testId: (await makeTest(prisma, catalog)).id };
}

const makeFree = (catalog: Catalog) =>
  prisma.testSeries.update({
    where: { id: catalog.testSeriesId },
    data: { kind: TEST_SERIES_KIND.FREE },
  });

const student = async (fullName: string, currentBranchId: string | null = null) =>
  (await makeStudent(prisma, { fullName, currentBranchId })).id;

const sit = (testId: string, studentId: string, score: number, timeTakenSec = 1800) =>
  makeSitting(prisma, { testId, studentId, score, timeTakenSec });

describe('the merit list', () => {
  it('takes the top of the ranking, and names each branch’s best', async () => {
    const { testId } = await freeTest();
    const north = (await makeBranch(prisma, 'NORTH')).id;
    const south = (await makeBranch(prisma, 'SOUTH')).id;
    await sit(testId, await student('Ana', north), 50);
    await sit(testId, await student('Bala', north), 40);
    await sit(testId, await student('Chitra', south), 45);
    await sit(testId, await student('Dev'), 10);

    const document = await read(REPORT_KEYS.TEST_MERIT, { testId, top: 2 });

    assert.deepEqual(
      tableOf(document, 'Merit list').map((row) => [row.Rank, row.Student]),
      [
        [1, 'Ana'],
        [2, 'Chitra'],
      ],
    );
    assert.deepEqual(
      tableOf(document, 'Branch toppers').map((row) => [row.Branch, row.Student, row.Rank]),
      [
        ['NORTH', 'Ana', 1],
        ['SOUTH', 'Chitra', 2],
        ['No branch', 'Dev', 4],
      ],
    );
  });

  it('leaves a retake and a void sitting out, however high they scored', async () => {
    const { testId } = await freeTest();
    const ana = await student('Ana');
    await sit(testId, ana, 30);
    await makeSitting(prisma, { testId, studentId: ana, score: 90, attemptNo: 2, isGraded: false });
    const esha = await sit(testId, await student('Esha'), 95);
    await prisma.attempt.update({
      where: { id: esha.id },
      data: { status: ATTEMPT_STATUS.VOIDED, voidedAt: new Date() },
    });

    const document = await read(REPORT_KEYS.TEST_MERIT, { testId });

    assert.deepEqual(
      tableOf(document, 'Merit list').map((row) => [row.Student, row.Score]),
      [['Ana', 30]],
    );
  });
});

describe('the branch comparison', () => {
  it('sets each branch’s ranked sittings against the students the test reaches there', async () => {
    const { testId } = await freeTest();
    const north = (await makeBranch(prisma, 'NORTH')).id;
    const south = (await makeBranch(prisma, 'SOUTH')).id;
    await sit(testId, await student('Ana', north), 50);
    await student('Bala', north);
    await sit(testId, await student('Chitra', south), 20);

    const rows = tableOf(await read(REPORT_KEYS.TEST_BRANCHES, { testId }), 'Branches');

    assert.deepEqual(
      rows.map((row) => [
        row.Branch,
        row.Reached,
        row['Ranked sittings'],
        row['Participation (%)'],
      ]),
      [
        ['NORTH', 2, 1, 50],
        ['SOUTH', 1, 1, 100],
      ],
    );
    assert.equal(rows[0]?.['Mean score'], 50);
  });
});

describe('the absentees', () => {
  it('counts who the test reaches and lists those holding no sitting', async () => {
    const { testId } = await freeTest();
    await sit(testId, await student('Sat'), 10);
    await student('Waiting');

    const document = await read(REPORT_KEYS.TEST_ABSENTEES, { testId });

    assert.equal(figureOf(document, 'Absent'), 1);
    assert.deepEqual(
      tableOf(document, 'Absent').map((row) => row.Student),
      ['Waiting'],
    );
  });
});

describe('the sectional cutoffs', () => {
  const scored = (sectionId: string, score: number) =>
    packedSections([
      {
        baseConfigSectionId: sectionId,
        score,
        correctCount: 0,
        wrongCount: 0,
        unattemptedCount: 0,
        timeSpentSec: 0,
      },
    ]);

  it('qualifies a sitting that clears every qualifying section on the paper', async () => {
    const paper = await makePaper(prisma, { questions: ['English'], sections: ['English'] });
    await makeFree(paper.catalog);
    const [english = ''] = paper.sectionIds;
    await prisma.baseConfigSection.update({
      where: { id: english },
      data: { meritOrQualifying: MERIT_TYPE.QUALIFYING, qualifyingCutoff: 5 },
    });
    const cleared = await sit(paper.testId, await student('Ana'), 40);
    const short = await sit(paper.testId, await student('Bala'), 60);
    await prisma.attempt.update({
      where: { id: cleared.id },
      data: { sectionScores: scored(english, 5) },
    });
    await prisma.attempt.update({
      where: { id: short.id },
      data: { sectionScores: scored(english, 4.5) },
    });

    const document = await read(REPORT_KEYS.TEST_CUTOFFS, { testId: paper.testId });

    assert.equal(figureOf(document, 'Qualified'), 1);
    assert.equal(figureOf(document, 'Not qualified'), 1);
    assert.deepEqual(
      tableOf(document, 'Sectional cutoffs').map((row) => [row.Student, row.Result]),
      [
        ['Bala', 'Not qualified'],
        ['Ana', 'Qualified'],
      ],
    );
  });

  it('holds nobody to a qualifying section the paper does not carry', async () => {
    const { catalog, testId } = await freeTest();
    const absent = await makeSection(prisma, catalog, { name: 'English' });
    await prisma.baseConfigSection.update({
      where: { id: absent.id },
      data: { meritOrQualifying: MERIT_TYPE.QUALIFYING, qualifyingCutoff: 5 },
    });
    await sit(testId, await student('Ana'), 40);

    const document = await read(REPORT_KEYS.TEST_CUTOFFS, { testId });

    assert.equal(figureOf(document, 'Qualifying sections'), 0);
    assert.deepEqual(document.tables, []);
  });
});

describe('the void sittings', () => {
  it('says why each was set aside, and who by', async () => {
    const { testId } = await freeTest();
    const admin = await makeAdmin(prisma, { fullName: 'Hall Supervisor' });
    await sit(testId, await student('Ana'), 30);
    const esha = await sit(testId, await student('Esha'), 80);
    await prisma.attempt.update({
      where: { id: esha.id },
      data: {
        status: ATTEMPT_STATUS.VOIDED,
        voidedAt: new Date(),
        voidReason: 'Power cut in the hall',
        voidedById: admin.id,
      },
    });

    const rows = tableOf(await read(REPORT_KEYS.TEST_VOIDED, { testId }), 'Void sittings');

    assert.deepEqual(
      rows.map((row) => [row.Student, row.Reason, row['Void by']]),
      [['Esha', 'Power cut in the hall', 'Hall Supervisor']],
    );
  });
});

describe('the answer key', () => {
  it('names each question’s right option by its place on the paper, for a super admin only', async () => {
    const paper = await makePaper(prisma, { questions: ['Maths', 'English'] });
    const rightAt = (
      await prisma.paperQuestion.findFirstOrThrow({
        where: { testId: paper.testId, order: 1 },
        select: { optionIds: true },
      })
    ).optionIds.indexOf(RIGHT_OPTION);

    const rows = tableOf(
      await read(REPORT_KEYS.TEST_ANSWER_KEY, { testId: paper.testId }, SUPER_ADMIN),
      'Answer key',
    );

    assert.deepEqual(
      rows.map((row) => [row['#'], row.Answer, row.Marks, row['Negative marks']]),
      [
        [1, `Option ${rightAt + 1}`, 2, 0.5],
        [2, `Option ${rightAt + 1}`, 2, 0.5],
      ],
    );
    await assert.rejects(
      read(REPORT_KEYS.TEST_ANSWER_KEY, { testId: paper.testId }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
  });
});

describe('asking for a report', () => {
  const refusal = (code: string) => (error: unknown) =>
    AppException.is(error) && error.code === code;

  it('refuses one asked for without what it is about, naming the field', async () => {
    await assert.rejects(
      read(REPORT_KEYS.TEST_MERIT, {}),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        error.fieldErrors?.testId !== undefined,
    );
  });

  it('answers not found for a test that is not there', async () => {
    await assert.rejects(
      read(REPORT_KEYS.TEST_RESULTS, { testId: uid() }),
      refusal(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('GET admin/reports/:key/export', () => {
  it('writes the page’s rows under a cover sheet, and one audit row against the admin', async () => {
    const { testId } = await freeTest();
    await sit(testId, await student('Ana'), 50);
    await sit(testId, await student('Bala'), 40);

    const response = await fetch(
      `${baseUrl}/admin/reports/${REPORT_KEYS.TEST_MERIT}/export?testId=${testId}`,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const audit = await waitForAuditRows();

    assert.match(response.headers.get('content-disposition') ?? '', /test-merit-.+\.xlsx/);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['About', 'Merit list', 'Branch toppers'],
    );
    assert.equal(workbook.getWorksheet('Merit list')?.getRow(2).getCell(2).value, 'Ana');
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.feature, AUDIT_FEATURE.REPORT);
    assert.equal(audit[0]?.action, AUDIT_ACTION.EXPORT);
    assert.equal(audit[0]?.entityId, VIEWER.id);
    assert.deepEqual(audit[0]?.changed, {
      report: { from: null, to: REPORT_KEYS.TEST_MERIT },
      filters: { from: null, to: { testId } },
      rows: { from: null, to: 3 },
    });
  });
});

/** The interceptor files its row after the response, off the request's own promise. */
async function waitForAuditRows() {
  for (let tries = 0; tries < 50; tries += 1) {
    const rows = await prisma.rowActionLog.findMany();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}
