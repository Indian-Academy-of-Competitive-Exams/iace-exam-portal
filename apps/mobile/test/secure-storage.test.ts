import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecureStorage } from '../src/lib/secure-storage';

function fakeVault(seed: Record<string, string>) {
  const held = { ...seed };
  return {
    getItemAsync: async (key: string) => held[key] ?? null,
    setItemAsync: async (key: string, value: string) => void (held[key] = value),
    deleteItemAsync: async (key: string) => void delete held[key],
    read: () => held,
  };
}

test('a hydrated key reads back synchronously', async () => {
  const vault = fakeVault({ 'iace.mobile.auth': '{"accessToken":"a","refreshToken":"r"}' });
  const { storage, hydrate } = createSecureStorage(['iace.mobile.auth'], vault);

  assert.equal(storage.getItem('iace.mobile.auth'), null, 'nothing is readable before hydrate');
  await hydrate();
  assert.equal(storage.getItem('iace.mobile.auth'), '{"accessToken":"a","refreshToken":"r"}');
});

test('a write is readable immediately and reaches the vault', async () => {
  const vault = fakeVault({});
  const { storage, hydrate } = createSecureStorage(['iace.mobile.auth'], vault);
  await hydrate();

  storage.setItem('iace.mobile.auth', 'token');
  assert.equal(storage.getItem('iace.mobile.auth'), 'token', 'the mirror answers without awaiting');

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(vault.read()['iace.mobile.auth'], 'token', 'the write reached the vault');
});

test('clearing removes it from both', async () => {
  const vault = fakeVault({ 'iace.mobile.auth': 'token' });
  const { storage, hydrate } = createSecureStorage(['iace.mobile.auth'], vault);
  await hydrate();

  storage.removeItem('iace.mobile.auth');
  assert.equal(storage.getItem('iace.mobile.auth'), null);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(vault.read()['iace.mobile.auth'], undefined);
});
