import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { ActorTypes, AppException } from '@iace/contracts';
import { TokenService } from '../src/auth/token.service';
import { FakeConfig } from './support/fakes';

/** The real JwtService — signing is pure, so there is nothing worth faking. */
function build(overrides = {}) {
  const config = new FakeConfig(overrides);
  return new TokenService(new JwtService({}), config.asService());
}

const STUDENT_CLAIMS = { sub: 'stu_1', actor: ActorTypes.STUDENT, sid: 'sess_1' };

describe('TokenService', () => {
  it('round-trips a student access token', async () => {
    const tokens = build();

    const claims = await tokens.verifyAccess(await tokens.signAccess(STUDENT_CLAIMS));

    assert.equal(claims.sub, 'stu_1');
    assert.equal(claims.actor, ActorTypes.STUDENT);
    assert.equal(claims.sid, 'sess_1');
  });

  it('carries admin authority in the access token, and nothing extra for students', async () => {
    const tokens = build();

    const admin = await tokens.verifyAccess(
      await tokens.signAccess({
        sub: 'adm_1',
        actor: ActorTypes.ADMIN,
        sid: 's',
        isSuperAdmin: true,
        pages: ['questions.manage'],
      }),
    );
    assert.equal(admin.isSuperAdmin, true);
    assert.deepEqual(admin.pages, ['questions.manage']);

    const student = await tokens.verifyAccess(await tokens.signAccess(STUDENT_CLAIMS));
    assert.equal(student.isSuperAdmin, undefined);
    assert.equal(student.pages, undefined);
  });

  it('will not accept a refresh token as an access token', async () => {
    const tokens = build();
    const refresh = await tokens.signRefresh(STUDENT_CLAIMS);

    // The two are signed with SEPARATE secrets precisely so a leaked access
    // secret cannot mint 30-day refresh tokens — and so the long-lived token
    // cannot be presented as the short-lived one.
    await assert.rejects(
      () => tokens.verifyAccess(refresh),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('will not accept an access token as a refresh token', async () => {
    const tokens = build();
    const access = await tokens.signAccess(STUDENT_CLAIMS);

    await assert.rejects(
      () => tokens.verifyRefresh(access),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it("rejects a token signed with someone else's secret", async () => {
    const foreign = build({ JWT_ACCESS_SECRET: 'a-completely-different-secret-000000' });
    const ours = build();
    const theirToken = await foreign.signAccess(STUDENT_CLAIMS);

    await assert.rejects(
      () => ours.verifyAccess(theirToken),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('rejects a tampered token', async () => {
    const tokens = build();
    const [header, payload, signature] = (await tokens.signAccess(STUDENT_CLAIMS)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...STUDENT_CLAIMS, sub: 'stu_2' })).toString(
      'base64url',
    );

    // Split so a malformed token says WHICH part was missing.
    assert.ok(header, 'no header segment');
    assert.ok(payload, 'no payload segment');
    assert.ok(signature, 'no signature segment');
    await assert.rejects(
      () => tokens.verifyAccess(`${header}.${forged}.${signature}`),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('rejects a validly-signed token whose claims are the wrong shape', async () => {
    const config = new FakeConfig();
    const jwt = new JwtService({});
    const tokens = new TokenService(jwt, config.asService());

    // Correct signature, nonsense payload: the signature says "we minted this",
    // it does not say the contents still match what the guards expect.
    const odd = await jwt.signAsync(
      { sub: 'stu_1', actor: 'ROBOT', sid: 's' },
      { secret: config.get('JWT_ACCESS_SECRET') },
    );

    await assert.rejects(
      () => tokens.verifyAccess(odd),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('answers the same for expired and tampered, on purpose', async () => {
    const tokens = build({ JWT_ACCESS_TTL: '0s' });
    const expired = await tokens.signAccess(STUDENT_CLAIMS);

    await assert.rejects(
      () => tokens.verifyAccess(expired),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.message, 'Invalid or expired token');
        return true;
      },
    );
  });

  it('mints a DIFFERENT refresh token every time, even within one second', async () => {
    const tokens = build();

    // iat has one-second resolution, so without a per-token jti these come back
    // identical — and session rotation, which compares token hashes, quietly
    // stops rotating anything.
    const first = await tokens.signRefresh(STUDENT_CLAIMS);
    const second = await tokens.signRefresh(STUDENT_CLAIMS);

    assert.notEqual(first, second);
    const claims = await tokens.verifyRefresh(second);
    assert.equal(claims.sub, 'stu_1');
    assert.equal(claims.sid, 'sess_1');
  });

  it('exposes TTLs in seconds, matching the Redis session lifetime', () => {
    const tokens = build();

    assert.equal(tokens.accessTtlSec, 15 * 60);
    assert.equal(tokens.refreshTtlSec, 30 * 24 * 3600);
  });
});
