import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes } from '@iace/contracts';
import { signOutReasonOf, signedOutMessage } from '../src/signed-out-message';

test('a replacement names the kind of device that replaced it', () => {
  const cause = new AppException(ErrorCodes.SESSION_REPLACED, undefined, {
    details: { replacedBy: 'MOBILE' },
  });
  const reason = signOutReasonOf(cause);
  assert.deepEqual(reason, { replacedBy: 'MOBILE' });
  assert.equal(
    signedOutMessage(reason ?? null),
    'You were signed out because this account signed in on another phone.',
  );
});

test('an unknown replacing kind still says why', () => {
  const cause = new AppException(ErrorCodes.SESSION_REPLACED, undefined, {
    details: { replacedBy: 'TOASTER' },
  });
  assert.equal(
    signedOutMessage(signOutReasonOf(cause) ?? null),
    'You were signed out because this account signed in on another device.',
  );
});

test('an ordinary sign-out carries no reason and no message', () => {
  assert.equal(signOutReasonOf(new AppException(ErrorCodes.UNAUTHENTICATED)), undefined);
  assert.equal(signedOutMessage(null), null);
});
