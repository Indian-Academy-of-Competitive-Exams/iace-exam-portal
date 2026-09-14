import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthService } from '../src/auth/auth.service';
import { PinService } from '../src/auth/pin/pin.service';
import { FakeConfig, FakeRedis } from './support/fakes';

/** The importer's seam into auth; the branch and student seams run against Postgres in their own suites. */

function authService(): { auth: AuthService; pin: PinService } {
  const pin = new PinService(new FakeRedis().asService(), new FakeConfig().asService());
  // Only `hashPin` is exercised here, and it touches none of the rest.
  const auth = new AuthService(
    null as never,
    null as never,
    pin,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  return { auth, pin };
}

describe('AuthService.hashPin — the importer’s seam into auth', () => {
  /** The guarantee, end to end: a PIN the IMPORTER hashed must verify against the same PIN at LOGIN. */
  it('produces a hash the login path will accept', async () => {
    const { auth, pin } = authService();

    const hash = await auth.hashPin('9876');

    assert.equal(await pin.verify(hash, '9876'), true);
    assert.equal(await pin.verify(hash, '9875'), false);
  });

  /** Four digits is 10,000 candidates, so the hash must be worthless without the pepper. */
  it('peppers the PIN, so the hash is worthless on its own', async () => {
    const { auth } = authService();
    const unpeppered = new PinService(
      new FakeRedis().asService(),
      new FakeConfig({ PIN_PEPPER: 'a-completely-different-pepper-value' }).asService(),
    );

    const hash = await auth.hashPin('9876');

    assert.equal(await unpeppered.verify(hash, '9876'), false);
  });
});
