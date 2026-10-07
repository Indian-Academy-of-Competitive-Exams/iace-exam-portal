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
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  ErrorCodes,
  LANGUAGE_CODE,
  printablePaperQuerySchema,
  printablePaperSchema,
  type PrintablePaper,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { AttemptPaperService } from '../src/attempts/attempt-paper.service';
import { AdminPaperPrintController } from '../src/attempts/paper-print.controller';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeQuestion,
  resetDatabase,
  testPrisma,
  uid,
  type Paper,
} from './support/database';

const prisma = testPrisma();
const sheets = new PaperSheetService(prisma);
const papers = new AttemptPaperService(
  prisma,
  new AccessResolverService(prisma, new FakeRedis().asService()),
  new FakeStorage() as never,
  sheets,
);
const auditContext = new AuditContext();
const NO_CHOICES = printablePaperQuerySchema.parse({});

const ADMIN_ID = uid();
let isSuperAdmin = false;

/** tsx emits no decorator metadata, so Nest cannot inject by type; the route is inherited whole. */
class Controller extends AdminPaperPrintController {
  constructor() {
    super(papers, auditContext);
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
class PrintModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    const middleware = new AuditContextMiddleware(auditContext);
    consumer
      .apply((request: { user?: unknown }, _response: unknown, next: () => void) => {
        request.user = {
          id: ADMIN_ID,
          actor: ActorTypes.ADMIN,
          sessionId: uid(),
          isActive: true,
          isSuperAdmin,
          permissions: {},
        };
        next();
      }, middleware.use.bind(middleware))
      .forRoutes('*');
  }
}

let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(PrintModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
beforeEach(async () => {
  isSuperAdmin = false;
  await resetDatabase(prisma);
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** A two-question paper in English, which is what the fixture's questions are written in. */
async function englishPaper(): Promise<Paper> {
  const paper = await makePaper(prisma, {
    title: 'Mock 1',
    sections: ['Quant'],
    questions: ['Maths', 'Maths'],
  });
  await prisma.baseConfig.update({
    where: { id: paper.catalog.baseConfigId },
    data: { languages: [LANGUAGE_CODE.EN] },
  });
  return paper;
}

async function print(testId: string, query = ''): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/admin/tests/${testId}/paper/print${query}`);
  return { status: response.status, body: await response.json() };
}

const paperIn = (body: unknown): PrintablePaper =>
  printablePaperSchema.parse((body as { data: unknown }).data);

describe('GET admin/tests/:id/paper/print', () => {
  it('serves the paper in its own order with no answer on it, and logs that it left', async () => {
    const paper = await englishPaper();

    const { status, body } = await print(paper.testId);
    const printed = paperIn(body);
    const audit = await waitForAuditRows();

    assert.equal(status, 200);
    assert.deepEqual(
      printed.questions.map((question) => [question.order, question.options.length]),
      [
        [1, 4],
        [2, 4],
      ],
    );
    assert.equal(printed.maxMarks, 4);
    assert.equal(printed.answerKey, null);
    assert.equal(JSON.stringify(body).includes('isCorrect'), false);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.feature, AUDIT_FEATURE.TEST);
    assert.equal(audit[0]?.action, AUDIT_ACTION.EXPORT);
    assert.equal(audit[0]?.entityId, paper.testId);
    assert.deepEqual(audit[0]?.changed, {
      paper: { from: null, to: 2 },
      answerKey: { from: null, to: false },
    });
  });

  it('refuses the key to an admin who is not a super admin', async () => {
    const paper = await englishPaper();

    const { status, body } = await print(paper.testId, '?answerKey=true');

    assert.equal(status, 403);
    assert.equal((body as { error: { code: string } }).error.code, ErrorCodes.FORBIDDEN);
  });

  it('gives a super admin each answer by the letter its option is printed under', async () => {
    isSuperAdmin = true;
    const paper = await englishPaper();

    const printed = paperIn((await print(paper.testId, '?answerKey=true')).body);

    const [first] = printed.questions;
    const place = first?.options.findIndex((option) => option.id === RIGHT_OPTION) ?? -1;
    assert.deepEqual(printed.answerKey?.[0], {
      questionId: first?.questionId,
      answer: String.fromCodePoint(65 + place),
    });
  });
});

describe('printing a paper nobody has sat', () => {
  it('reads it fresh, and leaves no held copy for a sitting to be served', async () => {
    const paper = await englishPaper();
    await papers.printable(paper.testId, NO_CHOICES);

    const added = await makeQuestion(prisma, { subjectId: paper.items[0]?.subjectId ?? '' });
    await prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: paper.testId,
        baseConfigId: paper.catalog.baseConfigId,
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        questionId: added.id,
        questionVersionId: added.versionId,
        order: 3,
        marks: 2,
        negativeMarks: 0.5,
      },
    });

    assert.equal((await papers.printable(paper.testId, NO_CHOICES)).questions.length, 3);
    assert.equal((await sheets.servedOf(paper.testId)).length, 3);
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
