import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { AuditController } from '../src/audit/audit.controller';
import { SUPER_ADMIN_KEY } from '../src/common/security';

type Reflected = Parameters<Reflector['getAllAndOverride']>[1][number];

const reflector = new Reflector();

/** As the guard reads it: the handler's own word first, then its controller's. */
const superAdminOnly = (handler: Reflected) =>
  reflector.getAllAndOverride<boolean | undefined, string>(SUPER_ADMIN_KEY, [
    handler,
    AuditController,
  ]) === true;

describe('AuditController — who may read the log', () => {
  /** The failure this prevents: a route on the log left open to every admin, as all of them once were. */
  it('gates every route on being a super admin', () => {
    const { prototype } = AuditController;
    const routes = [
      prototype.rowActions,
      prototype.exportRowActions,
      prototype.imports,
      prototype.importFile,
    ];

    for (const handler of routes) assert.equal(superAdminOnly(handler), true, handler.name);
  });
});
