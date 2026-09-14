import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExamStagesController } from '../src/configs/exam-stages.controller';
import { SUPER_ADMIN_KEY } from '../src/common/security';

/** The stage layer is the catalog too: reading is open to whoever picks from it, writing is not. */
describe('ExamStagesController — who may write', () => {
  const gatedOn = (handler: keyof ExamStagesController) =>
    Reflect.getMetadata(SUPER_ADMIN_KEY, ExamStagesController.prototype[handler]) === true;

  it('gates every write on being a super admin', () => {
    assert.equal(gatedOn('create'), true);
    assert.equal(gatedOn('update'), true);
    assert.equal(gatedOn('remove'), true);
  });

  it('leaves the list readable by anyone who manages students', () => {
    assert.equal(gatedOn('list'), false);
  });
});
