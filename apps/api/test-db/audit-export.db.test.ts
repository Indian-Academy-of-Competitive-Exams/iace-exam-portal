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
import {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_FEATURE,
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  rowActionListQuerySchema,
  type AuditFeature,
} from '@iace/contracts';
import { AuditContext, AuditContextMiddleware, AuditInterceptor } from '../src/audit';
import { AuditController } from '../src/audit/audit.controller';
import { AuditService } from '../src/audit/audit.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { type AuthenticatedUser } from '../src/common/security';
import { FakeStorage } from '../test/support/fakes';
import { makeAdmin, resetDatabase, testPrisma, uid } from './support/database';
import { sheetRows } from './support/workbook';

const prisma = testPrisma();
const auditContext = new AuditContext();
const audit = new AuditService(prisma, new FakeStorage() as never);

let caller: AuthenticatedUser;

/** tsx emits no decorator metadata, so Nest cannot inject by type; the route itself is inherited whole. */
class ExportController extends AuditController {
  constructor() {
    super(audit, auditContext);
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
beforeEach(() => resetDatabase(prisma));
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function adminCaller(isSuperAdmin = false): Promise<AuthenticatedUser> {
  const { id } = await makeAdmin(prisma, { isSuperAdmin });
  return {
    id,
    actor: ActorTypes.ADMIN,
    sessionId: uid(),
    isSuperAdmin,
    isActive: true,
    permissions: { [FEATURE_KEYS.DATA_EXPORT]: PERMISSION_LEVELS.READ },
  };
}

/** Minutes apart, so the order the list sorts by is a fact of the data and not of insert timing. */
let minute = 0;
const actionBy = (actorId: string, feature: AuditFeature) =>
  prisma.rowActionLog.create({
    data: {
      feature,
      entityId: uid(),
      action: AUDIT_ACTION.UPDATE,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      actorId,
      createdAt: new Date(Date.UTC(2026, 8, 20, 6, (minute += 1))),
    },
  });

async function exportOf(query: Record<string, string> = {}) {
  const response = await fetch(
    `${baseUrl}/admin/audit/row-actions/export?${new URLSearchParams(query).toString()}`,
  );
  assert.equal(response.status, 200);
  return sheetRows(await response.arrayBuffer());
}

const viewerOf = (user: AuthenticatedUser) => ({
  id: user.id,
  isSuperAdmin: user.isSuperAdmin,
  isActive: user.isActive,
});

describe('GET admin/audit/row-actions/export', () => {
  it('gives a non-super admin only their own actions, as their list shows them', async () => {
    caller = await adminCaller();
    const other = await makeAdmin(prisma, { fullName: 'Someone Else' });
    await actionBy(caller.id, AUDIT_FEATURE.STUDENT);
    await actionBy(other.id, AUDIT_FEATURE.STUDENT);
    await actionBy(caller.id, AUDIT_FEATURE.QUESTION);
    await actionBy(other.id, AUDIT_FEATURE.QUESTION);
    // Naming another admin is ignored for a non-super admin, in the export as in the list.
    const query = { actorId: other.id };

    // Listed first: the export files an action of the caller's own once it has answered.
    const list = await audit.listRowActions(
      rowActionListQuerySchema.parse({ ...query, pageSize: 100 }),
      viewerOf(caller),
    );
    const rows = await exportOf(query);

    assert.equal(list.total, 2);
    assert.deepEqual(
      rows.map((row) => row.Record),
      list.items.map((item) => item.entityId),
    );
    assert.deepEqual(
      rows.map((row) => row.Actor),
      ['Database Tier Admin', 'Database Tier Admin'],
    );
  });

  it('gives a super admin every actor the filters match, newest first', async () => {
    caller = await adminCaller(true);
    const other = await makeAdmin(prisma, { fullName: 'Someone Else' });
    const first = await actionBy(caller.id, AUDIT_FEATURE.STUDENT);
    const second = await actionBy(other.id, AUDIT_FEATURE.STUDENT);
    await actionBy(other.id, AUDIT_FEATURE.QUESTION);

    const rows = await exportOf({ feature: AUDIT_FEATURE.STUDENT });

    assert.deepEqual(
      rows.map((row) => row.Record),
      [second.entityId, first.entityId],
    );
    assert.equal(rows[0]?.Actor, 'Someone Else');
  });

  it('writes one audit row naming the admin and the filters chosen', async () => {
    caller = await adminCaller();
    await actionBy(caller.id, AUDIT_FEATURE.STUDENT);

    await exportOf({ feature: AUDIT_FEATURE.STUDENT });
    const logged = await waitForExportRow();

    assert.equal(logged?.feature, AUDIT_FEATURE.AUDIT_LOG);
    assert.equal(logged?.entityId, caller.id);
    assert.deepEqual(logged?.changed, {
      filters: { from: null, to: { feature: [AUDIT_FEATURE.STUDENT], match: 'all' } },
      rows: { from: null, to: 1 },
    });
  });
});

/** The interceptor files its row after the response, off the request's own promise. */
async function waitForExportRow() {
  for (let tries = 0; tries < 50; tries += 1) {
    const row = await prisma.rowActionLog.findFirst({ where: { action: AUDIT_ACTION.EXPORT } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}
