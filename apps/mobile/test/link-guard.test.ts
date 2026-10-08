import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkGuard } from '../src/lib/link-guard';

const TEST_LINK = 'iace-mobile://test/abc?x=1';

test('a link is refused while a paper is on screen, and not remembered', () => {
  const guard = createLinkGuard();
  guard.settle(true);
  guard.setSitting(true);
  assert.equal(guard.admit(TEST_LINK), null);
  guard.setSitting(false);
  assert.equal(guard.admit(TEST_LINK), TEST_LINK, 'the same link passes once the paper is gone');
});

test('a link opened signed out is replayed as a path once the student signs in', () => {
  const guard = createLinkGuard();
  assert.equal(guard.settle(false), null);
  assert.equal(guard.admit(TEST_LINK), TEST_LINK);
  assert.equal(guard.settle(true), '/test/abc?x=1');
  assert.equal(guard.settle(true), null, 'replayed once');
});

test('a cold link that finds a session already held is left to the router', () => {
  const guard = createLinkGuard();
  guard.admit(TEST_LINK);
  assert.equal(guard.settle(true), null);
});

test('a link opened while signed in is not held for a later sign-in', () => {
  const guard = createLinkGuard();
  guard.settle(true);
  guard.admit(TEST_LINK);
  guard.settle(false);
  assert.equal(guard.settle(true), null);
});

test('a plain launch of the app is not a link to come back to', () => {
  const guard = createLinkGuard();
  guard.admit('iace-mobile:///');
  guard.settle(false);
  assert.equal(guard.settle(true), null);
});
