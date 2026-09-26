import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import 'reflect-metadata';
import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import ExcelJS from 'exceljs';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  ErrorCodes,
  EXPORT_MAX_ROWS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  STUDENT_EXPORT_VIEWS,
  STUDENT_TYPE,
  TEST_SCOPE,
  studentListQuerySchema,
  studentExportQuerySchema,
  type AdminPermissions,
} from '@iace/contracts';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { StudentOverviewService } from '../src/attempts/overview.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { type AuthenticatedUser } from '../src/common/security';
import { ImportsService } from '../src/imports/imports.service';
import { buildStudentExport } from '../src/students/student-export';
import { StudentsController } from '../src/students/students.controller';
import { StudentsService } from '../src/students/students.service';
import {
  FakeEventsService,
  FakeProgramsService,
  FakeStorage,
  fakeStartingPins,
} from '../test/support/fakes';
import {
  makeAdmin,
  makeBranch,
  makeStudent,
  makeSubject,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const prisma = testPrisma();
const rollups = new StudentOverviewService(prisma, new LeaderboardService(prisma));
const auditContext = new AuditContext();
/** `list` reads only Prisma; nothing else it holds is reached. */
const unused = null as never;
const students = new StudentsService(
  prisma,
  unused,
  unused,
  unused,
  unused,
  unused,
  auditContext,
  unused,
  unused,
);
const imports = new ImportsService(
  prisma,
  fakeStartingPins(),
  new FakeStorage() as never,
  new AuditService(prisma, new FakeStorage() as never),
  new FakeEventsService().asService(),
  new FakeProgramsService().asService(),
);

let caller: AuthenticatedUser;

/** tsx emits no decorator metadata, so Nest cannot inject by type; the route itself is inherited whole. */
class ExportController extends StudentsController {
  constructor() {
    super(students, unused, prisma, rollups, auditContext);
  }
}

// The parent's `@Inject(forwardRef)` is inherited metadata; the subclass passes its own.
Reflect.defineMetadata(SELF_DECLARED_DEPS_METADATA, [], ExportController);

@Module({
  controllers: [ExportController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
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
  caller = await adminWith({
    [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.READ,
    [FEATURE_KEYS.DATA_EXPORT]: PERMISSION_LEVELS.READ,
  });
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function adminWith(permissions: AdminPermissions): Promise<AuthenticatedUser> {
  const { id } = await makeAdmin(prisma);
  return {
    id,
    actor: ActorTypes.ADMIN,
    sessionId: uid(),
    isSuperAdmin: false,
    isActive: true,
    permissions,
  };
}

type Cell = ExcelJS.CellValue;

async function exportOf(query: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/admin/students/export?${new URLSearchParams(query).toString()}`);
}

async function rowsOf(response: Response): Promise<Record<string, Cell>[]> {
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  const sheet = workbook.worksheets[0];
  const headers = (sheet?.getRow(1).values as Cell[]).slice(1).map(String);
  const rows: Record<string, Cell>[] = [];
  sheet?.eachRow((row, at) => {
    if (at === 1) return;
    const values = row.values as Cell[];
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index + 1]])));
  });
  return rows;
}

let mobiles = 9_000_000_000;
const offline = async (branchId: string, over: Parameters<typeof makeStudent>[1] = {}) =>
  makeStudent(prisma, {
    mobile: String((mobiles += 1)),
    studentType: STUDENT_TYPE.OFFLINE,
    currentBranchId: branchId,
    ...over,
  });

describe('GET admin/students/export', () => {
  it('writes exactly the rows the list counts, under match=any with two filters', async () => {
    const hyderabad = await makeBranch(prisma, 'HYDERABAD');
    const warangal = await makeBranch(prisma, 'WARANGAL');
    await prisma.program.create({ data: { code: 'FOUNDATION', name: 'Foundation' } });
    await offline(hyderabad.id, { fullName: 'Asha' });
    await offline(warangal.id, { fullName: 'Bala', programs: ['FOUNDATION'] });
    await offline(warangal.id, { fullName: 'Chitra' });
    const query = { branchId: hyderabad.id, programCode: 'FOUNDATION', match: 'any' };

    const rows = await rowsOf(await exportOf(query));
    const { total } = await students.list(studentListQuerySchema.parse(query));

    assert.equal(total, 2);
    assert.equal(rows.length, total);
    assert.deepEqual(rows.map((row) => row['Full Name']).sort(), ['Asha', 'Bala']);
  });

  it('writes a roster the student importer reads back as every row an update, with no errors', async () => {
    const branch = await makeBranch(prisma, 'HYDERABAD');
    await prisma.program.create({ data: { code: 'FOUNDATION', name: 'Foundation' } });
    await prisma.exam.create({ data: { code: 'SSC CGL', name: 'SSC CGL', course: 'SSC' } });
    const full = await offline(branch.id, {
      fullName: 'Asha Rani',
      enrolledCourses: ['SSC', 'BANKING'],
      enrolledExams: ['SSC CGL'],
      programs: ['FOUNDATION'],
    });
    await prisma.studentProfile.create({
      data: {
        studentId: full.id,
        motherName: 'Lakshmi',
        fatherName: 'Ravi',
        dob: new Date('2001-04-05'),
        email: 'asha@example.com',
        gender: 'FEMALE',
        address: '12 MG Road, Hyderabad',
      },
    });
    await offline(branch.id, { fullName: 'Bala', programs: ['FOUNDATION'] });

    const response = await exportOf({ view: STUDENT_EXPORT_VIEWS.ROSTER });
    const plan = await imports.previewStudents(Buffer.from(await response.arrayBuffer()));

    assert.deepEqual(plan.fileErrors, []);
    assert.equal(plan.summary.total, 2);
    assert.equal(plan.summary.willUpdate, 2);
    for (const row of plan.rows) assert.deepEqual(row.errors, []);
    const asha = plan.rows.find((row) => row.existingStudentId === full.id);
    assert.deepEqual(asha?.enrolledCourses, ['SSC', 'BANKING']);
    assert.deepEqual(asha?.enrolledExams, ['SSC CGL']);
    assert.deepEqual(asha?.profile, {
      motherName: 'Lakshmi',
      fatherName: 'Ravi',
      dob: '2001-04-05',
      email: 'asha@example.com',
      gender: 'FEMALE',
      address: '12 MG Road, Hyderabad',
    });
  });

  it('refuses over the cap from the count alone, before a row is read', async () => {
    let read = false;
    const student = new Proxy(prisma.student, {
      get(target, key, receiver) {
        if (key === 'count') return () => Promise.resolve(EXPORT_MAX_ROWS + 1);
        if (key === 'findMany') read = true;
        return Reflect.get(target, key, receiver);
      },
    });
    const client = new Proxy(prisma, {
      get: (target, key, receiver) =>
        key === 'student' ? student : Reflect.get(target, key, receiver),
    });

    await assert.rejects(
      buildStudentExport({ prisma: client, rollups }, studentExportQuerySchema.parse({})),
      { code: ErrorCodes.EXPORT_TOO_LARGE },
    );
    assert.equal(read, false);
  });

  it('refuses the performance view without STUDENT_PERFORMANCE READ', async () => {
    const response = await exportOf({ view: STUDENT_EXPORT_VIEWS.PERFORMANCE });
    const body = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 403);
    assert.equal(body.error.code, ErrorCodes.FORBIDDEN);
  });

  it('writes one accuracy column per FULL-scope subject, matching the rollup rows', async () => {
    caller = await adminWith({
      ...caller.permissions,
      [FEATURE_KEYS.STUDENT_PERFORMANCE]: PERMISSION_LEVELS.READ,
    });
    const branch = await makeBranch(prisma);
    const asha = await offline(branch.id, { fullName: 'Asha' });
    await offline(branch.id, { fullName: 'Bala' });
    const quant = await makeSubject(prisma, 'Quant');
    const reasoning = await makeSubject(prisma, 'Reasoning');
    const computedAt = new Date();
    await prisma.studentStat.create({
      data: {
        studentId: asha.id,
        testsAttempted: 3,
        testsEvaluated: 2,
        sumScore: 90,
        totalAnswered: 40,
        totalCorrect: 30,
        sumTimeSec: 3600,
        computedAt,
      },
    });
    await prisma.studentSubjectStat.createMany({
      data: [
        { subjectId: quant.id, scope: TEST_SCOPE.FULL, attempted: 20, correct: 15 },
        { subjectId: reasoning.id, scope: TEST_SCOPE.FULL, attempted: 8, correct: 2 },
        // A sectional row is its own bucket and must not bleed into the FULL figure.
        { subjectId: quant.id, scope: TEST_SCOPE.SECTIONAL, attempted: 10, correct: 0 },
      ].map((row) => ({ ...row, studentId: asha.id, computedAt })),
    });

    const rows = await rowsOf(await exportOf({ view: STUDENT_EXPORT_VIEWS.PERFORMANCE }));
    const row = (name: string) => rows.find((candidate) => candidate.Student === name);

    assert.equal(row('Asha')?.['Tests attempted'], 3);
    assert.equal(row('Asha')?.['Average score'], 45);
    assert.equal(row('Asha')?.['Accuracy (%)'], 75);
    assert.equal(row('Asha')?.['Average time (sec)'], 1200);
    assert.equal(row('Asha')?.['Quant accuracy (%)'], 75);
    assert.equal(row('Asha')?.['Reasoning accuracy (%)'], 25);
    assert.equal(row('Bala')?.['Tests attempted'], 0);
    assert.equal(row('Bala')?.['Quant accuracy (%)'] ?? null, null);
    assert.equal(
      Object.keys(row('Asha') ?? {}).some((header) => /percentile/i.test(header)),
      false,
    );
  });

  it('writes one audit row naming the admin and the filters chosen', async () => {
    const branch = await makeBranch(prisma);
    await offline(branch.id);

    await rowsOf(await exportOf({ branchId: branch.id }));
    const rows = await waitForAuditRows();

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.feature, AUDIT_FEATURE.STUDENT);
    assert.equal(rows[0]?.action, AUDIT_ACTION.EXPORT);
    assert.equal(rows[0]?.entityId, caller.id);
    assert.deepEqual(rows[0]?.changed, {
      filters: {
        from: null,
        to: { branchId: [branch.id], match: 'all', sort: 'recent', view: 'roster' },
      },
      rows: { from: null, to: 1 },
    });
  });
});

/** Past Postgres's 32,767 bind parameters, with real ids in two different slices. */
describe('rollupsFor past the bind limit', () => {
  it('reads every slice and merges them', async () => {
    const branchId = (await makeBranch(prisma)).id;
    const subject = await makeSubject(prisma, 'Quant');
    const computedAt = new Date();
    const ids = Array.from({ length: 40_000 }, () => uid());
    const placed = [
      { at: 5_000, correct: 3 },
      { at: 35_000, correct: 1 },
    ];
    for (const { at, correct } of placed) {
      const { id } = await offline(branchId);
      ids[at] = id;
      await prisma.studentStat.create({ data: { studentId: id, testsAttempted: 1, computedAt } });
      await prisma.studentSubjectStat.create({
        data: {
          studentId: id,
          subjectId: subject.id,
          scope: TEST_SCOPE.FULL,
          attempted: 4,
          correct,
          computedAt,
        },
      });
    }

    const { subjects, byStudent } = await rollups.rollupsFor(ids);

    assert.deepEqual(subjects, [{ id: subject.id, name: 'Quant' }]);
    assert.equal(byStudent.size, 2);
    assert.equal(byStudent.get(ids[5_000] ?? '')?.subjectAccuracy.get(subject.id), 75);
    assert.equal(byStudent.get(ids[35_000] ?? '')?.subjectAccuracy.get(subject.id), 25);
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
