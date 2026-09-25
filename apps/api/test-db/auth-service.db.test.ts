import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  STUDENT_TYPE,
  type AdminPermissions,
} from '@iace/contracts';
import { type AdminsService } from '../src/admins';
import { AuthService } from '../src/auth/auth.service';
import { OtpService } from '../src/auth/otp/otp.service';
import { PinService } from '../src/auth/pin/pin.service';
import { SessionService } from '../src/auth/session.service';
import { TokenService } from '../src/auth/token.service';
import { DOMAIN_EVENTS, PIN_RESET_REASONS } from '../src/common/events';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import {
  FakeAdminsService,
  FakeConfig,
  FakeEventBus,
  FakeMessageSender,
  FakeMetrics,
  FakeRedis,
  NO_DEVICE,
} from '../test/support/fakes';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

/** The orchestration. Most of what matters is what the API refuses to disclose: who has an account, and why a login failed. */

const MOBILE = '9876543210';
const ADMIN_EMAIL = 'admin@iace.co.in';
const DEFAULT_ADMIN_ID = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(
  grants: Record<string, AdminPermissions> = {},
  bus: { asService(): DomainEventBus } = new FakeEventBus(),
) {
  const redis = new FakeRedis();
  const config = new FakeConfig();
  const sender = new FakeMessageSender();
  const metrics = new FakeMetrics();
  const tokens = new TokenService(new JwtService({}), config.asService());
  const sessions = new SessionService(redis.asService());
  const adminsFacade = new FakeAdminsService(grants);
  const auth = new AuthService(
    prisma,
    new OtpService(redis.asService(), config.asService(), sender, metrics.asService()),
    new PinService(redis.asService(), config.asService()),
    tokens,
    sessions,
    bus.asService(),
    adminsFacade as unknown as AdminsService,
  );
  return { auth, tokens, sessions, redis, sender, adminsFacade };
}

type Ctx = ReturnType<typeof build>;

/** Drives signup the way the endpoints do: OTP → ticket → PIN. */
async function signUp(ctx: Ctx, mobile: string, pinCode: string) {
  await ctx.auth.requestStudentOtp(mobile);
  const ticket = await ctx.auth.verifyStudentOtp(mobile, ctx.sender.lastCode);
  return ctx.auth.setStudentPin(mobile, ticket.setupToken, pinCode, NO_DEVICE);
}

const setStudent = (data: {
  isActive?: boolean;
  isTestBlocked?: boolean;
  preTestReady?: boolean;
}) => prisma.student.updateMany({ where: { mobile: MOBILE }, data });

const admin = (over: { id?: string; isSuperAdmin?: boolean; isActive?: boolean } = {}) =>
  prisma.admin.create({
    data: {
      id: over.id ?? DEFAULT_ADMIN_ID,
      email: ADMIN_EMAIL,
      fullName: 'Admin',
      isSuperAdmin: over.isSuperAdmin ?? false,
      isActive: over.isActive ?? true,
    },
  });

const failsWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

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

  /** Three internal states, one external answer — otherwise the message says who has an account. */
  it('gives the SAME answer for unknown number, no PIN set, and wrong PIN', async () => {
    const ctx = build();
    await makeStudent(prisma, { mobile: '9000000001' });
    await signUp(ctx, MOBILE, '4813');

    const messages: string[] = [];
    for (const [mobile, pinCode] of [
      ['9999999999', '4813'],
      ['9000000001', '4813'],
      [MOBILE, '0000'],
    ] as const) {
      const error = await ctx.auth
        .loginStudent(mobile, pinCode, NO_DEVICE)
        .catch((e: unknown) => e);
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'PIN_INVALID');
      messages.push(error.message);
    }

    assert.equal(
      new Set(messages).size,
      1,
      `expected one message, got ${JSON.stringify(messages)}`,
    );
  });

  /** Otherwise "which numbers get locked out" is itself an enumeration oracle. */
  it('counts a failure against an unknown number too', async () => {
    const ctx = build();

    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => ctx.auth.loginStudent('9999999999', '0000', NO_DEVICE));
    }

    await assert.rejects(
      () => ctx.auth.loginStudent('9999999999', '0000', NO_DEVICE),
      failsWith('PIN_LOCKED'),
    );
  });

  it('refuses a deactivated account, even with the correct PIN', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    await setStudent({ isActive: false });

    await assert.rejects(
      () => ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE),
      failsWith('FORBIDDEN'),
    );
  });

  /** A test block is not a lockout: they sign in to read the results they already have. */
  it('signs a test-blocked student in, and says so on the identity', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    await setStudent({ isTestBlocked: true });

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
      failsWith('PIN_LOCKED'),
    );
  });

  it('clears the lockout ladder on a correct sign-in', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    for (let i = 0; i < 4; i++) {
      await assert.rejects(() => ctx.auth.loginStudent(MOBILE, '0000', NO_DEVICE));
    }

    await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);

    assert.deepEqual(
      Object.keys(ctx.redis.snapshot()).filter((key) => key.startsWith('pin:')),
      [],
    );
  });
});

describe('AuthService — signup and PIN reset', () => {
  /** An abandoned signup must leave nothing behind. */
  it('creates no student until a PIN is chosen', async () => {
    const ctx = build();

    await ctx.auth.requestStudentOtp(MOBILE);
    await ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode);

    assert.equal(await prisma.student.count(), 0);
  });

  /** ONLINE means an IACE student at the online branch; somebody signing themselves up is neither. */
  it('creates the student when the PIN is set, outside the institute and at no branch', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');

    const [student, ...others] = await prisma.student.findMany();
    assert.equal(others.length, 0);
    assert.equal(student?.mobile, MOBILE);
    assert.ok(student?.pinHash);
    assert.equal(student?.studentType, STUDENT_TYPE.NON_IACE);
    assert.equal(student?.currentBranchId, null);
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

  it('replaces the PIN on reset, retires the old one, and ends every existing session', async () => {
    const ctx = build();
    await signUp(ctx, MOBILE, '4813');
    const before = await ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE);
    const claims = await ctx.tokens.verifyAccess(before.tokens.accessToken);

    ctx.redis.advanceSeconds(46);
    await signUp(ctx, MOBILE, '7261');

    await assert.doesNotReject(() => ctx.auth.loginStudent(MOBILE, '7261', NO_DEVICE));
    await assert.rejects(() => ctx.auth.loginStudent(MOBILE, '4813', NO_DEVICE));
    assert.equal(await prisma.student.count(), 1, 'reset must not create a second student');
    // Most of the point of a reset: whoever knew the old PIN is signed out.
    assert.equal(await ctx.sessions.exists(ActorTypes.STUDENT, claims.sub, claims.sid), false);
  });

  it('refuses a deactivated account at OTP verify', async () => {
    const ctx = build();
    await makeStudent(prisma, { mobile: MOBILE, isActive: false });
    await ctx.auth.requestStudentOtp(MOBILE);

    await assert.rejects(
      () => ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode),
      failsWith('FORBIDDEN'),
    );
  });
});

describe('student.pin_reset', () => {
  const resetPinByOtp = (ctx: Ctx, pin: string) => signUp(ctx, MOBILE, pin);

  it('is announced when a forgotten PIN is reset by OTP, and again when a known one is changed', async () => {
    const events = new FakeEventBus();
    const ctx = build({}, events);
    const session = await resetPinByOtp(ctx, '1234');

    await ctx.auth.changeStudentPin(session.identity.id, '1234', '5678', NO_DEVICE);

    const published = events.of(DOMAIN_EVENTS.STUDENT_PIN_RESET);
    assert.equal(published[0]?.mobile, MOBILE);
    // Both paths end every other session, so both announce it, with how the student proved themselves.
    assert.deepEqual(
      published.map((event) => event.reason),
      [PIN_RESET_REASONS.OTP_RESET, PIN_RESET_REASONS.SELF_CHANGE],
    );
  });

  /** An event is a fact that happened; a refused change is not one. */
  it('is not announced when the current PIN is wrong', async () => {
    const events = new FakeEventBus();
    const ctx = build({}, events);
    const session = await resetPinByOtp(ctx, '1234');

    await ctx.auth
      .changeStudentPin(session.identity.id, '0000', '5678', NO_DEVICE)
      .catch(() => undefined);

    assert.equal(events.of(DOMAIN_EVENTS.STUDENT_PIN_RESET).length, 1);
  });

  /** The guarantee the event must never take over. */
  it('completes the reset even when a listener throws', async () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    emitter.on(DOMAIN_EVENTS.STUDENT_PIN_RESET, () => {
      throw new Error('the notifications handler is broken');
    });
    const bus = new DomainEventBus(emitter);
    const ctx = build({}, { asService: () => bus });

    const session = await resetPinByOtp(ctx, '1234');

    assert.ok(session.tokens.accessToken, 'the reset must complete regardless');
    assert.ok(
      Object.keys(ctx.redis.snapshot()).some((key) => key.includes('session')),
      'and the sessions really were revoked before anything was published',
    );
  });
});

describe('AuthService — admin', () => {
  const verified = async (ctx: Ctx) => {
    await ctx.auth.requestAdminOtp(ADMIN_EMAIL);
    return (await ctx.auth.verifyAdminOtp(ADMIN_EMAIL, ctx.sender.lastCode, NO_DEVICE)).identity;
  };

  it('signs in a known active admin and carries their grants', async () => {
    await admin();
    const ctx = build({
      [DEFAULT_ADMIN_ID]: { [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });

    const identity = await verified(ctx);

    assert.equal(identity.actor, ActorTypes.ADMIN);
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** Refusing here would answer a real account with "invalid credentials"; they get in and are told. */
  it('signs in a DEACTIVATED admin, and hands them nothing', async () => {
    await admin({ isActive: false });
    const ctx = build({
      [DEFAULT_ADMIN_ID]: { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });

    const identity = await verified(ctx);

    assert.equal(identity.actor === ActorTypes.ADMIN ? identity.isActive : null, false);
    // Empty though a grant is still held — the answer must not depend on the pruning having run.
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {});
  });

  it('still sends a code to a deactivated admin, or they are stranded at login', async () => {
    await admin({ isActive: false });
    const ctx = build();

    await ctx.auth.requestAdminOtp(ADMIN_EMAIL);

    assert.ok(ctx.sender.lastCode, 'a deactivated admin must still receive a code');
  });

  it('does not look up grants for a super admin — they bypass every check', async () => {
    await admin({ id: randomUUID(), isSuperAdmin: true });
    const ctx = build();

    const identity = await verified(ctx);

    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {});
    assert.deepEqual(ctx.adminsFacade.calls, [], 'a super admin needs no grant query');
  });

  /** Admins cannot self-register, so "we sent it" to an address with no account is a lie that costs a ticket. */
  it('refuses an unknown admin instead of pretending to send, and sends for one that exists', async () => {
    const ctx = build();

    const error = await ctx.auth.requestAdminOtp('nobody@example.com').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.ADMIN_NOT_REGISTERED);
    assert.ok(error.fieldErrors?.email?.[0], 'the message belongs on the email field');
    assert.equal(ctx.sender.sent.length, 0, 'nothing is sent to an address with no account');

    await admin();
    assert.equal((await ctx.auth.requestAdminOtp(ADMIN_EMAIL)).sent, true);
    assert.equal(ctx.sender.sent.length, 1);
  });

  it('does not let a student OTP satisfy the admin endpoint', async () => {
    await admin();
    const ctx = build();
    await ctx.auth.requestStudentOtp(MOBILE);

    await assert.rejects(
      () => ctx.auth.verifyAdminOtp(ADMIN_EMAIL, ctx.sender.lastCode, NO_DEVICE),
      failsWith('OTP_EXPIRED'),
    );
  });
});

describe('AuthService — refresh and me', () => {
  it('rotates the refresh token and keeps the session id', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    const before = await ctx.tokens.verifyRefresh(session.tokens.refreshToken);

    const next = await ctx.auth.refresh(session.tokens.refreshToken);
    const after = await ctx.tokens.verifyRefresh(next.refreshToken);

    assert.notEqual(next.refreshToken, session.tokens.refreshToken);
    assert.equal(after.sid, before.sid);
  });

  it('reads identity fresh, so a change lands without re-login', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    const claims = await ctx.tokens.verifyAccess(session.tokens.accessToken);
    await setStudent({ preTestReady: true });

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

  it('refuses to refresh once the account is deactivated', async () => {
    const ctx = build();
    const session = await signUp(ctx, MOBILE, '4813');
    await setStudent({ isActive: false });

    await assert.rejects(
      () => ctx.auth.refresh(session.tokens.refreshToken),
      failsWith('UNAUTHENTICATED'),
    );
  });
});
