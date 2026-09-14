import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExamsController } from '../src/configs/exams.controller';
import { SUPER_ADMIN_KEY } from '../src/common/security';

/** The catalog every enrolment validates against: reading it is open to whoever manages students, writing is not. */
describe('ExamsController — who may write', () => {
  const gatedOn = (handler: keyof ExamsController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamsController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages students', () => {
    assert.equal(gatedOn('list'), false);
  });
});
