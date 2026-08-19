import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_ACTION, AUDIT_FEATURE } from '@iace/contracts';
import { TOGGLE_ACTIONS, resolveAuditAction } from '../src/audit/audit.decorator';

describe('resolveAuditAction', () => {
  it('passes a fixed action straight through', () => {
    const action = resolveAuditAction(
      { feature: AUDIT_FEATURE.STUDENT, action: AUDIT_ACTION.UPDATE },
      {},
    );

    assert.equal(action, AUDIT_ACTION.UPDATE);
  });

  /**
   * The failure this prevents: sign-in and test-taking are separate columns and separate admin
   * actions, so one pair of enum values standing for both is how "who deactivated this student"
   * gets answered about the wrong switch.
   */
  it('reads the sign-in toggle as ACTIVATE or DEACTIVATE', () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.signIn };

    assert.equal(resolveAuditAction(route, { isActive: true }), AUDIT_ACTION.ACTIVATE);
    assert.equal(resolveAuditAction(route, { isActive: false }), AUDIT_ACTION.DEACTIVATE);
  });

  it('reads the tests toggle as BLOCK or UNBLOCK, never as DEACTIVATE', () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.tests };

    assert.equal(resolveAuditAction(route, { isTestBlocked: true }), AUDIT_ACTION.BLOCK);
    assert.equal(resolveAuditAction(route, { isTestBlocked: false }), AUDIT_ACTION.UNBLOCK);
  });

  it('survives a body that is not an object', () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.signIn };

    assert.equal(resolveAuditAction(route, undefined), AUDIT_ACTION.DEACTIVATE);
  });

  it('survives a body missing isTestBlocked, defaulting to UNBLOCK', () => {
    const route = { feature: AUDIT_FEATURE.STUDENT, action: TOGGLE_ACTIONS.tests };

    assert.equal(resolveAuditAction(route, {}), AUDIT_ACTION.UNBLOCK);
  });
});
