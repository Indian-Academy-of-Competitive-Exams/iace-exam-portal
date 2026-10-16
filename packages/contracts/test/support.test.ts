import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_INFO,
  createTicketSchema,
  loginHelpSchema,
} from '../src/support';

describe('support contracts', () => {
  it('requires a sitting for a test or result query', () => {
    const parsed = createTicketSchema.safeParse({
      category: SUPPORT_CATEGORIES.TEST_OR_RESULT,
      body: 'My answer did not save',
    });
    assert.equal(parsed.success, false);
  });

  it('accepts any other category without a sitting', () => {
    const parsed = createTicketSchema.safeParse({
      category: SUPPORT_CATEGORIES.APP_PROBLEM,
      body: 'The app closes on open',
    });
    assert.equal(parsed.success, true);
  });

  it('only lets the login category be raised signed out', () => {
    const signedOut = Object.values(SUPPORT_CATEGORIES).filter(
      (c) => SUPPORT_CATEGORY_INFO[c].signedOut,
    );
    assert.deepEqual(signedOut, [SUPPORT_CATEGORIES.LOGIN_OR_ACCOUNT]);
  });

  it('refuses a login-help claim without a contact email', () => {
    const parsed = loginHelpSchema.safeParse({
      fullName: 'Asha Rao',
      registeredMobile: '9876543210',
      dob: '2001-04-09',
      fatherName: 'Ravi Rao',
      branchId: '0190f3c0-0000-7000-8000-000000000001',
      problem: 'OTP_NOT_ARRIVING',
      body: 'No code arrives',
    });
    assert.equal(parsed.success, false);
  });
});
