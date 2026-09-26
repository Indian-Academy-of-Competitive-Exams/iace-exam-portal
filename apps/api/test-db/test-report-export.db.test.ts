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
  TEST_SERIES_KIND,
  XLSX_CONTENT_TYPE,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { packedSections } from '../src/attempts/score-paper';
import { standingsSql, type StandingRow } from '../src/attempts/ranking-sql';
import { AdminTestAnalyticsController } from '../src/attempts/test-analytics.controller';
import { TestAnalyticsService } from '../src/attempts/test-analytics.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { FakeQueue, FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  makeCatalog,
  makeSection,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  type Catalog,
} from './support/database';

const prisma = testPrisma();

const access = new AccessResolverService(prisma, new FakeRedis().asService());
const analytics = new TestAnalyticsService(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  access,
);
const auditContext = new AuditContext();

/** tsx emits no decorator metadata, so Nest cannot inject by type; the route itself is inherited whole. */
class ReportController extends AdminTestAnalyticsController {
  constructor() {
    super(analytics, prisma, access, auditContext);
  }
}

@Module({
  controllers: [ReportController],
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
class ReportModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    const middleware = new AuditContextMiddleware(auditContext);
    consumer.apply(middleware.use.bind(middleware)).forRoutes('*');
  }
}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(ReportModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
beforeEach(() => resetDatabase(prisma));
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

type Cell = ExcelJS.CellValue;

interface Download {
  response: Response;
  sheet: (name: string) => Record<string, Cell>[];
  headers: (name: string) => string[];
}

async function download(testId: string): Promise<Download> {
  const response = await fetch(`${baseUrl}/admin/tests/${testId}/report/export`);
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());

  const headers = (name: string): string[] => {
    const values = workbook.getWorksheet(name)?.getRow(1).values as Cell[];
    return values.slice(1).map(String);
  };
  const sheet = (name: string): Record<string, Cell>[] => {
    const names = headers(name);
    const rows: Record<string, Cell>[] = [];
    workbook.getWorksheet(name)?.eachRow((row, at) => {
      if (at === 1) return;
      const values = row.values as Cell[];
      rows.push(Object.fromEntries(names.map((header, index) => [header, values[index + 1]])));
    });
    return rows;
  };
  return { response, sheet, headers };
}

/** A switched-on FREE series reaches every live student, so who is absent is plain to read. */
async function freeTest(): Promise<{ catalog: Catalog; testId: string }> {
  const catalog = await makeCatalog(prisma);
  await prisma.testSeries.update({
    where: { id: catalog.testSeriesId },
    data: { kind: TEST_SERIES_KIND.FREE, isEnabled: true },
  });
  return { catalog, testId: (await makeTest(prisma, catalog)).id };
}

const student = async (fullName: string, over: Parameters<typeof makeStudent>[1] = {}) =>
  (await makeStudent(prisma, { fullName, ...over })).id;

const cellNumber = (cell: Cell | undefined): number | null =>
  cell === undefined || cell === null ? null : Number(cell);

describe('GET admin/tests/:id/report/export', () => {
  it('ranks every cohort sitting exactly as standingsSql does, and lists the rest unranked', async () => {
    const { testId } = await freeTest();
    const ana = await student('Ana');
    const sit = async (name: string, score: number, timeTakenSec?: number) => ({
      name,
      id: (
        await makeSitting(prisma, { testId, studentId: await student(name), score, timeTakenSec })
      ).id,
    });
    const ranked = [
      {
        name: 'Ana',
        id: (await makeSitting(prisma, { testId, studentId: ana, score: 50, timeTakenSec: 1000 }))
          .id,
      },
      await sit('Bala', 50, 900),
      await sit('Chitra', 50),
      await sit('Dev', 30),
    ];
    // Chitra's time was never recorded: she ranks as the slowest of the tie.
    await prisma.attempt.update({ where: { id: ranked[2]?.id }, data: { timeTakenSec: null } });
    await makeSitting(prisma, { testId, studentId: ana, score: 70, attemptNo: 2, isGraded: false });
    const voided = await sit('Esha', 80);
    await prisma.attempt.update({
      where: { id: voided.id },
      data: { status: ATTEMPT_STATUS.VOIDED, voidedAt: new Date() },
    });

    const results = (await download(testId)).sheet('Results');
    assert.equal(results.length, 6);

    for (const { name, id } of ranked) {
      const [standing] = await prisma.$queryRaw<StandingRow[]>(standingsSql({ attemptId: id }));
      const row = results.find((r) => r.Student === name && r['Attempt no'] === 1);
      assert.equal(cellNumber(row?.Rank), standing?.rank, `${name} rank`);
      assert.equal(cellNumber(row?.Percentile), standing?.percentile, `${name} percentile`);
    }
    assert.deepEqual(
      results.slice(0, 4).map((row) => row.Student),
      ['Bala', 'Ana', 'Chitra', 'Dev'],
    );
    const unranked = results.slice(4);
    assert.deepEqual(unranked.map((row) => row.Student).sort(), ['Ana', 'Esha']);
    for (const row of unranked) assert.equal(row.Rank ?? null, null);
  });

  it('lists as absent exactly the live students reached who hold no sitting', async () => {
    const { testId } = await freeTest();
    const sat = await student('Sat');
    await student('Waiting');
    await student('Inactive', { isActive: false });
    await student('Deleted', { deletedAt: new Date() });
    await makeSitting(prisma, { testId, studentId: sat, score: 10 });

    const absent = (await download(testId)).sheet('Absent');

    assert.deepEqual(
      absent.map((row) => row.Student),
      ['Waiting'],
    );
  });

  it('unpacks each sitting’s section scores and writes Submitted at on the IST clock', async () => {
    const { catalog, testId } = await freeTest();
    const reasoning = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
    const quant = await makeSection(prisma, catalog, { name: 'Quant', order: 2 });
    await prisma.testSectionStat.createMany({
      data: [reasoning, quant].map((section) => ({
        testId,
        baseConfigSectionId: section.id,
        computedAt: new Date(),
      })),
    });
    const sitting = await makeSitting(prisma, {
      testId,
      studentId: await student('Ana'),
      score: 12,
      submittedAt: new Date('2026-06-01T20:00:00.000Z'),
    });
    await prisma.attempt.update({
      where: { id: sitting.id },
      data: {
        sectionScores: packedSections([
          {
            baseConfigSectionId: quant.id,
            score: 8,
            correctCount: 4,
            wrongCount: 1,
            unattemptedCount: 5,
            timeSpentSec: 300,
          },
          {
            baseConfigSectionId: reasoning.id,
            score: 4,
            correctCount: 2,
            wrongCount: 0,
            unattemptedCount: 8,
            timeSpentSec: 200,
          },
        ]),
      },
    });

    const [row] = (await download(testId)).sheet('Results');

    assert.equal(row?.['Reasoning score'], 4);
    assert.equal(row?.['Reasoning correct'], 2);
    assert.equal(row?.['Reasoning wrong'], 0);
    assert.equal(row?.['Quant score'], 8);
    assert.equal(row?.['Quant correct'], 4);
    assert.equal(row?.['Quant wrong'], 1);
    // 20:00 UTC is 01:30 the next morning in Kolkata.
    assert.deepEqual(row?.['Submitted at'], new Date('2026-06-02T01:30:00.000Z'));
  });

  it('downloads a test nobody has sat as a workbook of headers', async () => {
    const { testId } = await freeTest();

    const { response, sheet, headers } = await download(testId);

    assert.equal(response.headers.get('content-type'), XLSX_CONTENT_TYPE);
    assert.match(response.headers.get('content-disposition') ?? '', /test-report-.+\.xlsx/);
    assert.equal(headers('Results')[0], 'Rank');
    assert.equal(sheet('Results').length, 0);
    assert.equal(headers('Summary')[0], 'Figure');
  });

  it('writes one audit row naming the test and the rows it carried', async () => {
    const { testId } = await freeTest();
    await makeSitting(prisma, { testId, studentId: await student('Ana'), score: 10 });
    await makeSitting(prisma, { testId, studentId: await student('Bala'), score: 20 });

    await download(testId);
    const rows = await waitForAuditRows();

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.feature, AUDIT_FEATURE.TEST);
    assert.equal(rows[0]?.action, AUDIT_ACTION.EXPORT);
    assert.equal(rows[0]?.entityId, testId);
    assert.deepEqual(rows[0]?.changed, { rows: { from: null, to: 2 } });
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
