import test from 'node:test';
import assert from 'node:assert/strict';
import { tabIdFrom } from '../src/exam/tab-id';
import { fakeStorage } from './support/fake-storage';

test('a stored tab id is returned without minting a new one', () => {
  const storage = fakeStorage();
  storage.setItem('tab', 'held');

  assert.equal(
    tabIdFrom(storage, 'tab', () => assert.fail('nothing should be minted')),
    'held',
  );
});

test('with no id stored, one is minted once and answered from then on', () => {
  const storage = fakeStorage();
  let minted = 0;
  const mint = () => `minted-${++minted}`;

  assert.equal(tabIdFrom(storage, 'tab', mint), 'minted-1');
  assert.equal(tabIdFrom(storage, 'tab', mint), 'minted-1', 'a second read is the same device');
  assert.equal(minted, 1);
});
