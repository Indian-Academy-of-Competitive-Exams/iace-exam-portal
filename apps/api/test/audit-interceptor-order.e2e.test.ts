import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import 'reflect-metadata';
import { Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR, NestFactory, Reflector } from '@nestjs/core';
import { AUDIT_ACTION, AUDIT_FEATURE } from '@iace/contracts';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { Audit, AuditContext, AuditInterceptor } from '../src/audit';
import { AuditService, type AuditEntry } from '../src/audit/audit.service';
import { AppModule } from '../src/app.module';

/**
 * End to end over real HTTP, through a real Nest app wired the way AppModule wires the two
 * `APP_INTERCEPTOR` entries: ResponseInterceptor registered before AuditInterceptor, so
 * AuditInterceptor runs on the inside and sees the handler's own return value.
 */

@Controller('probe')
class ProbeController {
  /** No `:id` param — entityId can only come from the handler's own return value. */
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.CREATE)
  @Post()
  create() {
    return { id: 'probe_1' };
  }
}

const entries: AuditEntry[] = [];

@Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector, context: AuditContext, audit: AuditService) =>
        new AuditInterceptor(reflector, context, audit),
      inject: [Reflector, AuditContext, AuditService],
    },
    AuditContext,
    {
      provide: AuditService,
      useValue: { record: (entry: AuditEntry) => Promise.resolve(void entries.push(entry)) },
    },
  ],
})
class ProbeModule {}

describe('AuditInterceptor registered after ResponseInterceptor (audit e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  before(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  after(async () => {
    await app.close();
  });

  /**
   * The failure this prevents: swap the two `APP_INTERCEPTOR` entries in app.module.ts and
   * AuditInterceptor runs outside ResponseInterceptor instead — it taps `{ success, data,
   * meta }`, not the handler's `{ id: 'probe_1' }`, finds no `.id`, and a CREATE route (no
   * `:id` param to fall back on) files no audit row at all. No exception, no log: the event
   * just never fires, and the audit log silently has a hole in it.
   */
  it('files the audit row against the handler’s real id, with no :id param to fall back on', async () => {
    const response = await fetch(`${baseUrl}/probe`, { method: 'POST' });
    const body = (await response.json()) as { data: { id: string } };

    assert.equal(body.data.id, 'probe_1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.entityId, 'probe_1');
  });

  /**
   * The failure this prevents: the test above proves WHY the order matters, but it pins its own
   * fixture — swapping the two entries in `app.module.ts` leaves it green. This one reads the
   * shipped wiring, so the ordering the docblock above describes is actually guarded.
   */
  it('registers AuditInterceptor after ResponseInterceptor in AppModule itself', () => {
    const providers = (Reflect.getMetadata('providers', AppModule) ?? []) as {
      provide?: unknown;
      useClass?: unknown;
    }[];
    const interceptors = providers
      .filter((provider) => provider?.provide === APP_INTERCEPTOR)
      .map((provider) => provider.useClass);

    const response = interceptors.indexOf(ResponseInterceptor);
    const audit = interceptors.indexOf(AuditInterceptor);

    assert.notEqual(response, -1, 'ResponseInterceptor is not an APP_INTERCEPTOR in AppModule');
    assert.notEqual(audit, -1, 'AuditInterceptor is not an APP_INTERCEPTOR in AppModule');
    assert.ok(audit > response, 'AuditInterceptor must be registered after ResponseInterceptor');
  });
});
