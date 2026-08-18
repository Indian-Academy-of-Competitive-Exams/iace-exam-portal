import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AdminPermissions,
  AppException,
  ErrorCodes,
} from '@iace/contracts';
import { AuthService } from '../src/auth/auth.service';
import { type AdminsService } from '../src/admins';
import { OtpService } from '../src/auth/otp/otp.service';
import { PinService } from '../src/auth/pin/pin.service';
import { SessionService } from '../src/auth/session.service';
import { TokenService } from '../src/auth/token.service';
import {
  FakeConfig,
  FakeEventBus,
  FakeMessageSender,
  FakePrisma,
  FakeRedis,
  NO_DEVICE,
  FakeAdminsService,
  makeAdmin,
  makeStudent,
  type FakeAdmin,
  type FakeStudent,
} from './support/fakes';

/**
 * The orchestration. Most of what matters here is what the API refuses to disclose: whether a
 * number is registered, and why exactly a login failed.
 */

const MOBILE = '9876543210';

function build(
  students: FakeStudent[] = [],
  admins: FakeAdmin[] = [],
  grants: Record<string, AdminPermissions> = {},
) {
  const redis = new FakeRedis();
  const config = new FakeConfig();
  const sender = new FakeMessageSender();
  const prisma = new FakePrisma(students, admins);

  const otp = new OtpService(redis.asService(), config.asService(), sender);
  const pin = new PinService(redis.asService(), config.asService());
  const tokens = new TokenService(new JwtService({}), config.asService());
  const sessions = new SessionService(redis.asService());

  const events = new FakeEventBus();

  const adminsFacade = new FakeAdminsService(grants);

  const auth = new AuthService(
    prisma.asService(),
    otp,
    pin,
    tokens,
    sessions,
    events.asService(),
    adminsFacade as unknown as AdminsService,
  );
  return { auth, otp, pin, tokens, sessions, prisma, redis, sender, config, events, adminsFacade };
}

/** Drives signup the way the endpoints do: OTP → ticket → PIN. */
async function signUp(ctx: ReturnType<typeof build>, mobile: string, pinCode: string) {
  await ctx.auth.requestStudentOtp(mobile);
  const ticket = await ctx.auth.verifyStudentOtp(mobile, ctx.sender.lastCode);
  return ctx.auth.setStudentPin(mobile, ticket.setupToken, pinCode, NO_DEVICE);
}

describe('AuthService — student login', () => {
  it('signs in with the right PIN and returns tokens plus identity', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');

    const { tokens, identity } = await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);

    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);
    assert.equal(identity.actor, ActorTypes.STUDENT);
    assert.equal(identity.mobile, MOBILE);
  });

  it('gives the SAME answer for unknown number, no PIN set, and wrong PIN', async () => {
    // Three different internal states, one external answer — otherwise the
    // error message becomes a way to discover who has an account.
    const ctx = build([makeStudent({ id: 'no_pin', mobile: '9000000001', pinHash: null })]);
    await signUp(ctx, MOBILE, '4813');

    const messages: string[] = [];
    for (const [mobile, pinCode] of [
      ['9999999999', '4813'], // no such student
      ['9000000001', '4813'], // exists, never set a PIN
      [MOBILE, '0000'], // exists, wrong PIN
    ] as const) {
      await assert.rejects(
        () => ctx.auth.loginStudent(mobile, pinCode, NO_DEVICE),
        (error: unknown) => {
          assert.ok(AppException.is(error));
          assert.equal(error.code, 'PIN_INVALID');
          messages.push(error.message);
          return true;
        },
      );
    }

    assert.equal(
      new Set(messages).size,
      1,
      `expected one message, got ${JSON.stringify(messages)}`,
    );
  });

  it('counts a failure against an unknown number too', async () => {
    // Otherwise "which numbers get locked out" is itself an enumeration oracle.
    const ctx = build();

    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => ctx.auth.loginStudent('9999999999', '0000', NO_DEVICE));
    }

    await assert.rejects(
      () => ctx.auth.loginStudent('9999999999', '0000', NO_DEVICE),
      (e: unknown) => AppException.is(e) && e.code === 'PIN_LOCKED',
    );
  });

  it('refuses a deactivated account, even with the correct PIN', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    ctx.prisma.students[0]!.isActive = false;

    await assert.rejects(
      () => ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });

  /**
   * A test-blocked student is the admin's "deactivate", and it must NOT be a lockout: they sign in to
   * read the results they already have. Gating login on it took their own history away from them.
   */
  it('signs a test-blocked student in, and says so on the identity', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    ctx.prisma.students[0]!.isTestBlocked = true;

    const { identity } = await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);

    assert.equal(identity.actor === ActorTypes.STUDENT ? identity.isTestBlocked : null, true);
  });

  it('checks the lockout before the PIN, so a locked number cannot be probed', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => ctx.auth.loginStudent(MOBILE, '0000', NO_DEVICE));
    }

    await assert.rejects(
      () => ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE),
      (e: unknown) => AppException.is(e) && e.code === 'PIN_LOCKED',
    );
  });

  it('clears the lockout ladder on a correct sign-in', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    for (let i = 0; i < 4; i++) {
      await assert.rejects(() => ctx.auth.loginStudent(MOBILE, '0000', NO_DEVICE));
    }

    await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);

    const pinKeys = Object.keys(ctx.redis.snapshot()).filter((k) => k.startsWith('pin:'));
    assert.deepEqual(pinKeys, []);
  });
});

describe('AuthService — signup and PIN reset', () => {
  it('creates no student until a PIN is chosen', async () => {
    const ctx = build();

    await ctx.auth.requestStudentOtp(MOBILE);
    await ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode);

    // An abandoned signup must leave nothing behind.
    assert.equal(ctx.prisma.students.length, 0);
  });

  it('creates the student when the PIN is set', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');

    assert.equal(ctx.prisma.students.length, 1);
    assert.equal(ctx.prisma.students[0]?.mobile, MOBILE);
    assert.ok(ctx.prisma.students[0]?.pinHash);
  });

  it('tells the caller whether this is a signup or a reset', async () => {
    const ctx = build();

    await ctx.auth.requestStudentOtp(MOBILE);
    const first = await ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode);
    assert.equal(first.pinAlreadySet, false);

    await ctx.auth.setStudentPin(MOBILE, first.setupToken, '4813', NO_DEVICE);

    ctx.redis.advanceSeconds(46);
    await ctx.auth.requestStudentOtp(MOBILE);
    const second = await ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode);
    assert.equal(second.pinAlreadySet, true);
  });

  it('replaces the PIN on reset and retires the old one', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');

    ctx.redis.advanceSeconds(46);
    await signUp(ctx, MOBILE, '7261');

    await assert.doesNotReject(() => ctx.auth.loginStudent(MOBILE, '7261', NO_DEVICE));
    await assert.rejects(() => ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE));
    assert.equal(ctx.prisma.students.length, 1, 'reset must not create a second student');
  });

  it('ends every existing session when the PIN is reset', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    const before = await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);
    const claims = await ctx.tokens.verifyAccess(before.tokens.accessToken);

    ctx.redis.advanceSeconds(46);
    await signUp(ctx, MOBILE, '7261');

    // Most of the point of a reset: whoever knew the old PIN is signed out.
    assert.equal(await ctx.sessions.exists(ActorTypes.STUDENT, claims.sub, claims.sid), false);
  });

  it('refuses a deactivated account at OTP verify', async () => {
    const ctx = build([makeStudent({ mobile: MOBILE, isActive: false })]);
    await ctx.auth.requestStudentOtp(MOBILE);

    await assert.rejects(
      () => ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode),
      (e: unknown) => AppException.is(e) && e.code === 'FORBIDDEN',
    );
  });
});

describe('AuthService — admin', () => {
  it('signs in a known active admin and carries their grants', async () => {
    const ctx = build([], [makeAdmin({ id: 'adm_1', isSuperAdmin: false })], {
      adm_1: { [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });
    await ctx.auth.requestAdminOtp('admin@iace.co.in');

    const { identity } = await ctx.auth.verifyAdminOtp(
      'admin@iace.co.in',
      ctx.sender.lastCode,
      NO_DEVICE,
    );

    assert.equal(identity.actor, ActorTypes.ADMIN);
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  it('signs in a DEACTIVATED admin, and hands them nothing', async () => {
    // The point of the change: refusing here would answer a real account with "invalid credentials",
    // which reads as a typo. They get in, and the app tells them what actually happened.
    const ctx = build([], [makeAdmin({ id: 'adm_1', isSuperAdmin: false, isActive: false })], {
      adm_1: { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });
    await ctx.auth.requestAdminOtp('admin@iace.co.in');

    const { identity } = await ctx.auth.verifyAdminOtp(
      'admin@iace.co.in',
      ctx.sender.lastCode,
      NO_DEVICE,
    );

    assert.equal(identity.actor === ActorTypes.ADMIN ? identity.isActive : null, false);
    // Empty even though the fake still holds a grant — the answer must not
    // depend on the pruning having succeeded.
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {});
  });

  it('still sends a code to a deactivated admin, or they are stranded at login', async () => {
    const ctx = build([], [makeAdmin({ id: 'adm_1', isActive: false })]);

    await ctx.auth.requestAdminOtp('admin@iace.co.in');

    assert.ok(ctx.sender.lastCode, 'a deactivated admin must still receive a code');
  });

  it('does not look up grants for a super admin — they bypass every check', async () => {
    const ctx = build([], [makeAdmin({ id: 'adm_root', isSuperAdmin: true })]);
    await ctx.auth.requestAdminOtp('admin@iace.co.in');

    const { identity } = await ctx.auth.verifyAdminOtp(
      'admin@iace.co.in',
      ctx.sender.lastCode,
      NO_DEVICE,
    );

    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {});
    assert.deepEqual(ctx.adminsFacade.calls, [], 'a super admin needs no grant query');
  });

  /**
   * Admins cannot self-register, so "we sent it" to an address with no account is a lie that costs a
   * support ticket. The trade is deliberate: this endpoint will say which addresses are admins.
   */
  it('refuses an unknown admin instead of pretending to send', async () => {
    const ctx = build();

    const error = await ctx.auth.requestAdminOtp('nobody@example.com').then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.ADMIN_NOT_REGISTERED);
    assert.ok(error.fieldErrors?.email?.[0], 'the message belongs on the email field');
    assert.equal(ctx.sender.sent.length, 0, 'nothing is sent to an address with no account');
  });

  it('still sends for an admin that exists', async () => {
    const ctx = build([], [makeAdmin({ email: 'admin@iace.co.in' })]);

    const response = await ctx.auth.requestAdminOtp('admin@iace.co.in');

    assert.equal(response.sent, true);
    assert.equal(ctx.sender.sent.length, 1);
  });

  it('does not let a student OTP satisfy the admin endpoint', async () => {
    const ctx = build([], [makeAdmin({ email: 'admin@iace.co.in' })]);
    await ctx.auth.requestStudentOtp(MOBILE);

    await assert.rejects(
      () => ctx.auth.verifyAdminOtp('admin@iace.co.in', ctx.sender.lastCode, NO_DEVICE),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });
});

describe('AuthService — refresh and me', () => {
  it('rotates the refresh token and keeps the session id', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    const before = await ctx.tokens.verifyRefresh(session.tokens.refreshToken);

    const next = await ctx.auth.refresh(session.tokens.refreshToken, NO_DEVICE);
    const after = await ctx.tokens.verifyRefresh(next.refreshToken);

    assert.notEqual(next.refreshToken, session.tokens.refreshToken);
    assert.equal(after.sid, before.sid);
  });

  it('reads identity fresh, so a change lands without re-login', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    const claims = await ctx.tokens.verifyAccess(session.tokens.accessToken);
    ctx.prisma.students[0]!.preTestReady = true;

    const identity = await ctx.auth.me({
      id: claims.sub,
      actor: ActorTypes.STUDENT,
      sessionId: claims.sid,
      isSuperAdmin: false,
      isActive: true,
      permissions: {},
    });

    assert.equal(identity.actor === ActorTypes.STUDENT ? identity.preTestReady : null, true);
  });

  it('refuses to refresh once the account is gone or deactivated', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    ctx.prisma.students[0]!.isActive = false;

    await assert.rejects(
      () => ctx.auth.refresh(session.tokens.refreshToken, NO_DEVICE),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });
});
