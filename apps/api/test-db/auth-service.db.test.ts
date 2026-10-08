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
  type FeatureKey,
} from '@iace/contracts';
import { type Prisma } from '@prisma/client';
import { AdminsService } from '../src/admins';
import { AuditContext } from '../src/audit';
import { AuthService } from '../src/auth/auth.service';
import { OtpService } from '../src/auth/otp/otp.service';
import { SessionService } from '../src/auth/session.service';
import { TokenService } from '../src/auth/token.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import { type PrismaService } from '../src/prisma/prisma.service';
import {
  FakeConfig,
  FakeEventBus,
  FakeMessageSender,
  FakeMetrics,
  FakeRedis,
  NO_DEVICE,
} from '../test/support/fakes';
import { makeStudent, resetDatabase, testPrisma, type StudentOverrides } from './support/database';

/** The orchestration. Most of what matters is who is let in, and what the API refuses to disclose about who has an account. */

const MOBILE = '9876543210';
const ADMIN_EMAIL = 'admin@iace.co.in';
const DEFAULT_ADMIN_ID = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(
  bus: { asService(): DomainEventBus } = new FakeEventBus(),
  env: ConstructorParameters<typeof FakeConfig>[0] = {},
  client: PrismaService = prisma,
) {
  const redis = new FakeRedis();
  const config = new FakeConfig(env);
  const sender = new FakeMessageSender();
  const metrics = new FakeMetrics();
  const tokens = new TokenService(new JwtService({}), config.asService());
  const sessions = new SessionService(redis.asService());
  const auth = new AuthService(
    client,
    new OtpService(redis.asService(), config.asService(), sender, metrics.asService()),
    tokens,
    sessions,
    bus.asService(),
    new AdminsService(prisma, new AuditContext(), new FakeEventBus().asService()),
    metrics.asService(),
  );
  return { auth, tokens, sessions, redis, sender, metrics };
}

type Ctx = ReturnType<typeof build>;

/** Signs in the way the endpoints do: a code asked for, then the code back. A first time is the signup. */
async function signIn(ctx: Ctx, mobile: string) {
  await ctx.auth.requestStudentOtp(mobile);
  return ctx.auth.verifyStudentOtp(mobile, ctx.sender.lastCode, NO_DEVICE);
}

const setStudent = (data: { isActive?: boolean; isTestBlocked?: boolean }) =>
  prisma.student.updateMany({ where: { mobile: MOBILE }, data });

const grant = (featureKey: FeatureKey) =>
  prisma.adminFeaturePermission.create({
    data: { adminId: DEFAULT_ADMIN_ID, featureKey, level: PERMISSION_LEVELS.WRITE },
  });

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

/** The real client, with a rival taking the number just before a sign-up's own create lands. */
function takenJustBefore(rival: StudentOverrides): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== 'student') return Reflect.get(target, key) as unknown;
      return new Proxy(target.student, {
        get(delegate, method: string | symbol) {
          if (method !== 'create') return Reflect.get(delegate, method) as unknown;
          return async (args: Prisma.StudentCreateArgs) => {
            await makeStudent(prisma, rival);
            return delegate.create(args);
          };
        },
      });
    },
  });
}

const sessionKeys = (ctx: Ctx) =>
  Object.keys(ctx.redis.snapshot()).filter((key) => key.startsWith('session:'));

describe('AuthService — a student signs in with a code', () => {
  it('signs in a student the roster holds, and returns tokens plus identity', async () => {
    const ctx = build();
    await makeStudent(prisma, { mobile: MOBILE });

    const { tokens, identity } = await signIn(ctx, MOBILE);

    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);
    assert.equal(identity.actor, ActorTypes.STUDENT);
    assert.equal(identity.mobile, MOBILE);
    assert.equal(await prisma.student.count(), 1);
    assert.deepEqual(ctx.metrics.authAttempts, ['ok']);
  });

  /** Asking for a code proves nothing, so it must not leave a row behind for every number typed. */
  it('creates no student until the code is proved', async () => {
    const ctx = build();

    await ctx.auth.requestStudentOtp(MOBILE);

    assert.equal(await prisma.student.count(), 0);
  });

  it('makes the account on the first sign-in, outside the institute and at no branch, once', async () => {
    const bus = new FakeEventBus();
    const ctx = build(bus);

    const first = await signIn(ctx, MOBILE);
    const again = await signIn(ctx, MOBILE);

    const [student, ...others] = await prisma.student.findMany();
    assert.equal(others.length, 0);
    assert.equal(student?.studentType, STUDENT_TYPE.NON_IACE);
    assert.equal(student?.currentBranchId, null);
    assert.equal(again.identity.id, first.identity.id);
    assert.deepEqual(bus.of(DOMAIN_EVENTS.STUDENT_SIGNED_UP), [{ studentId: first.identity.id }]);
  });

  /** The failure this prevents: a guessed code opening an account, or making one. */
  it('refuses a wrong code, counts it apart, and lets nobody in', async () => {
    const ctx = build();
    await ctx.auth.requestStudentOtp(MOBILE);
    const wrong = ctx.sender.lastCode === '000000' ? '111111' : '000000';

    await assert.rejects(
      () => ctx.auth.verifyStudentOtp(MOBILE, wrong, NO_DEVICE),
      failsWith(ErrorCodes.OTP_INVALID),
    );

    assert.equal(await prisma.student.count(), 0);
    assert.deepEqual(ctx.metrics.authAttempts, ['bad_code']);
    assert.ok(!Object.keys(ctx.redis.snapshot()).some((key) => key.startsWith('session:')));
  });

  it('refuses a deactivated account, even with the right code', async () => {
    const ctx = build();
    await makeStudent(prisma, { mobile: MOBILE });
    await setStudent({ isActive: false });

    await assert.rejects(() => signIn(ctx, MOBILE), failsWith(ErrorCodes.FORBIDDEN));

    assert.deepEqual(ctx.metrics.authAttempts, ['deactivated']);
  });

  /** Blocked from tests is not blocked from signing in: their results stay theirs to read. */
  it('signs a test-blocked student in, and says so on the identity', async () => {
    const ctx = build();
    await makeStudent(prisma, { mobile: MOBILE });
    await setStudent({ isTestBlocked: true });

    const { identity } = await signIn(ctx, MOBILE);

    assert.equal(identity.actor === ActorTypes.STUDENT && identity.isTestBlocked, true);
  });

  /** The failure this prevents: codes asked for unknown numbers pausing every student's sign-in for the day. */
  it('pays for a stranger’s code from the signup budget, and a student’s from their own', async () => {
    const ctx = build(new FakeEventBus(), {
      OTP_RESEND_COOLDOWN_SEC: 0,
      OTP_MAX_PER_DAY: 1000,
      OTP_MAX_PER_DAY_PER_IP: 1000,
      NOTIFICATION_COST_SMS_PAISE: 100,
      OTP_GLOBAL_DAILY_BUDGET_PAISE: 1000,
      OTP_SIGNUP_DAILY_BUDGET_PAISE: 100,
    });
    await makeStudent(prisma, { mobile: MOBILE });
    await ctx.auth.requestStudentOtp('9000000001');

    await assert.rejects(
      () => ctx.auth.requestStudentOtp('9000000002'),
      failsWith(ErrorCodes.RATE_LIMITED),
    );

    assert.equal((await ctx.auth.requestStudentOtp(MOBILE)).sent, true);
  });

  /** The failure this prevents: a code spent on "That already exists" because the desk added the number mid sign-in. */
  it('signs a first sign-in in to the account an admin made a moment before it', async () => {
    const bus = new FakeEventBus();
    const ctx = build(bus, {}, takenJustBefore({ mobile: MOBILE }));

    const { identity } = await signIn(ctx, MOBILE);

    const [held, ...others] = await prisma.student.findMany();
    assert.equal(others.length, 0);
    assert.equal(identity.id, held?.id);
    assert.deepEqual(bus.of(DOMAIN_EVENTS.STUDENT_SIGNED_UP), []);
    assert.deepEqual(ctx.metrics.authAttempts, ['ok']);
  });

  it('still refuses a suspended account reached by losing that race', async () => {
    const ctx = build(new FakeEventBus(), {}, takenJustBefore({ mobile: MOBILE, isActive: false }));

    await assert.rejects(() => signIn(ctx, MOBILE), failsWith(ErrorCodes.FORBIDDEN));

    assert.deepEqual(ctx.metrics.authAttempts, ['deactivated']);
    assert.deepEqual(sessionKeys(ctx), []);
  });

  it('leaves one account and one session when two first sign-ins land together', async () => {
    const ctx = build();
    await ctx.auth.requestStudentOtp(MOBILE);
    const code = ctx.sender.lastCode;

    const [won, lost] = await Promise.allSettled([
      ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE),
      ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE),
    ]);

    assert.equal(won.status, 'fulfilled');
    assert.ok(lost.status === 'rejected');
    assert.ok(failsWith(ErrorCodes.OTP_EXPIRED)(lost.reason));
    assert.equal(await prisma.student.count(), 1);
    assert.equal(sessionKeys(ctx).length, 1);
  });

  /** The guarantee the event must never take over. */
  it('signs a new student in even when a listener throws', async () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    emitter.on(DOMAIN_EVENTS.STUDENT_SIGNED_UP, () => {
      throw new Error('the notifications handler is broken');
    });
    const ctx = build({ asService: () => new DomainEventBus(emitter) });

    const session = await signIn(ctx, MOBILE);

    assert.ok(session.tokens.accessToken, 'the sign-in must complete regardless');
  });
});

describe('AuthService — the code an admin reads out at the desk', () => {
  const studentId = async () => (await makeStudent(prisma, { mobile: MOBILE })).id;

  /** The failure this prevents: a hall where the codes are not arriving and nobody can be let in. */
  it('signs the student in with a code that was read out and never sent', async () => {
    const ctx = build();

    const { code, expiresInSec } = await ctx.auth.issueStudentDeskCode(await studentId());
    const { identity } = await ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE);

    assert.equal(ctx.sender.sent.length, 0);
    assert.equal(expiresInSec, 300);
    assert.equal(identity.actor === ActorTypes.STUDENT && identity.mobile, MOBILE);
  });

  /** A student pressing Resend while they queue must not void the code the desk just gave them. */
  it('survives a sent code asked for after it, and is good once', async () => {
    const ctx = build();
    const { code } = await ctx.auth.issueStudentDeskCode(await studentId());
    await ctx.auth.requestStudentOtp(MOBILE);

    await ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE);

    await assert.rejects(
      () => ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE),
      failsWith(ErrorCodes.OTP_EXPIRED),
    );
  });

  it('stops opening anything once its five minutes are up', async () => {
    const ctx = build();
    const { code, expiresInSec } = await ctx.auth.issueStudentDeskCode(await studentId());

    ctx.redis.advanceSeconds(expiresInSec + 1);

    await assert.rejects(
      () => ctx.auth.verifyStudentOtp(MOBILE, code, NO_DEVICE),
      failsWith(ErrorCodes.OTP_EXPIRED),
    );
  });

  it('is not issued for a suspended student, nor for one who is not there', async () => {
    const ctx = build();
    const id = await studentId();
    await setStudent({ isActive: false });

    await assert.rejects(() => ctx.auth.issueStudentDeskCode(id), failsWith(ErrorCodes.CONFLICT));
    await assert.rejects(
      () => ctx.auth.issueStudentDeskCode(randomUUID()),
      failsWith(ErrorCodes.NOT_FOUND),
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
    await grant(FEATURE_KEYS.QUESTION_MANAGEMENT);
    const ctx = build();

    const identity = await verified(ctx);

    assert.equal(identity.actor, ActorTypes.ADMIN);
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {
      [FEATURE_KEYS.QUESTION_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
  });

  /** Authority is read per request, so a revoke is never held back by a token still in hand. */
  it('mints an access token that names who and which session, and nothing they could lose', async () => {
    await admin({ isSuperAdmin: true });
    const ctx = build();
    await ctx.auth.requestAdminOtp(ADMIN_EMAIL);

    const { tokens } = await ctx.auth.verifyAdminOtp(ADMIN_EMAIL, ctx.sender.lastCode, NO_DEVICE);

    const payload = JSON.parse(
      Buffer.from(tokens.accessToken.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    assert.deepEqual(
      ['isSuperAdmin', 'isActive', 'permissions'].filter((claim) => claim in payload),
      [],
    );
    assert.equal(payload.sub, DEFAULT_ADMIN_ID);
  });

  /** Refusing here would answer a real account with "invalid credentials"; they get in and are told. */
  it('signs in a DEACTIVATED admin, and hands them nothing', async () => {
    await admin({ isActive: false });
    await grant(FEATURE_KEYS.STUDENT_MANAGEMENT);
    const ctx = build();

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

  it('hands a super admin the bypass and no grants — they need none', async () => {
    await admin({ isSuperAdmin: true });
    await grant(FEATURE_KEYS.STUDENT_MANAGEMENT);
    const ctx = build();

    const identity = await verified(ctx);

    assert.equal(identity.actor === ActorTypes.ADMIN ? identity.isSuperAdmin : null, true);
    assert.deepEqual(identity.actor === ActorTypes.ADMIN ? identity.permissions : null, {});
  });

  /** Switched off means no bypass either: every raw super-admin check downstream reads this flag. */
  it('hands a deactivated super admin no bypass', async () => {
    await admin({ isSuperAdmin: true, isActive: false });
    const ctx = build();

    const identity = await verified(ctx);

    assert.equal(identity.actor === ActorTypes.ADMIN ? identity.isSuperAdmin : null, false);
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
    const session = await signIn(ctx, MOBILE);
    const before = await ctx.tokens.verifyRefresh(session.tokens.refreshToken);

    const next = await ctx.auth.refresh(session.tokens.refreshToken);
    const after = await ctx.tokens.verifyRefresh(next.refreshToken);

    assert.notEqual(next.refreshToken, session.tokens.refreshToken);
    assert.equal(after.sid, before.sid);
  });

  it('reads identity fresh, so a change lands without re-login', async () => {
    const ctx = build();
    const session = await signIn(ctx, MOBILE);
    const claims = await ctx.tokens.verifyAccess(session.tokens.accessToken);
    await prisma.studentProfile.create({
      data: {
        studentId: claims.sub,
        motherName: 'Lakshmi',
        fatherName: 'Ravi',
        dob: new Date('2003-04-11'),
      },
    });

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
    const session = await signIn(ctx, MOBILE);
    await setStudent({ isActive: false });

    await assert.rejects(
      () => ctx.auth.refresh(session.tokens.refreshToken),
      failsWith('UNAUTHENTICATED'),
    );
  });
});
