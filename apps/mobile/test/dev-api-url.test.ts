import test from 'node:test';
import assert from 'node:assert/strict';
import { devApiUrl } from '../src/lib/dev-api-url';

test('the API is reached on the host the bundle was served from', () => {
  assert.equal(devApiUrl('192.168.88.18:8081', 'ios'), 'http://192.168.88.18:3000');
  assert.equal(devApiUrl('192.168.88.18:8081', 'android'), 'http://192.168.88.18:3000');
});

test('an Android emulator reaches the Mac through its alias, not its own loopback', () => {
  assert.equal(devApiUrl('127.0.0.1:8081', 'android'), 'http://10.0.2.2:3000');
  assert.equal(devApiUrl('localhost:8081', 'android'), 'http://10.0.2.2:3000');
});

test('the iOS simulator shares the Mac network, so loopback stays loopback', () => {
  assert.equal(devApiUrl('localhost:8081', 'ios'), 'http://localhost:3000');
});

test('with no Metro host there is nothing to derive', () => {
  assert.equal(devApiUrl(undefined, 'ios'), undefined);
  assert.equal(devApiUrl('', 'android'), undefined);
});
