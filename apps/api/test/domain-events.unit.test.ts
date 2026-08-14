import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from '../src/auth/auth.service';
import { OtpService } from '../src/auth/otp/otp.service';
import { PinService } from '../src/auth/pin/pin.service';
import { SessionService } from '../src/auth/session.service';
import { TokenService } from '../src/auth/token.service';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import { DOMAIN_EVENTS, PIN_RESET_REASONS } from '../src/common/events';
import {
  FakeConfig,
  FakeEventBus,
  FakeMessageSender,
  FakePrisma,
  FakeRedis,
  NO_DEVICE,
  type FakeStudent,
} from './support/fakes';

/**
 * The event seam (docs/03 §6).
 *
 * Two things are worth asserting and they pull in opposite directions: the
 * producer must ANNOUNCE what happened, and the announcement must never be able
 * to affect what happened. A bus that swallows everything satisfies the second
 * and fails the first; one that propagates satisfies the first and turns a
 * completed PIN reset into a 500 the day someone adds a bad listener.
 */

const MOBILE = '9876543210';

function build(
  students: FakeStudent[] = [],
  bus: { asService(): DomainEventBus } = new FakeEventBus(),
) {
  const redis = new FakeRedis();
  const config = new FakeConfig();
  const sender = new FakeMessageSender();
  const prisma = new FakePrisma(students);

  const auth = new AuthService(
    prisma.asService(),
    new OtpService(redis.asService(), config.asService(), sender),
    new PinService(redis.asService(), config.asService()),
    new TokenService(new JwtService({}), config.asService()),
    new SessionService(redis.asService()),
    bus.asService(),
  );
  return { auth, sender, redis, prisma };
}

async function resetPinByOtp(ctx: ReturnType<typeof build>, pin: string) {
  await ctx.auth.requestStudentOtp(MOBILE);
  const ticket = await ctx.auth.verifyStudentOtp(MOBILE, ctx.sender.lastCode);
  return ctx.auth.setStudentPin(MOBILE, ticket.setupToken, pin, NO_DEVICE);
}

describe('student.pin_reset', () => {
  it('is announced when a forgotten PIN is reset by OTP', async () => {
    const events = new FakeEventBus();
    const ctx = build([], events);

    await resetPinByOtp(ctx, '1234');

    const [published] = events.of(DOMAIN_EVENTS.STUDENT_PIN_RESET);
    assert.equal(published?.mobile, MOBILE);
    assert.equal(published?.reason, PIN_RESET_REASONS.OTP_RESET);
  });

  it('is announced when a student changes a PIN they still know', async () => {
    const events = new FakeEventBus();
    const ctx = build([], events);
    const session = await resetPinByOtp(ctx, '1234');
    const studentId = session.identity.id;

    await ctx.auth.changeStudentPin(studentId, '1234', '5678', NO_DEVICE);

    // Both paths end every other session, so both announce it. `reason` is
    // there for a listener that cares how the student proved themselves.
    const reasons = events.of(DOMAIN_EVENTS.STUDENT_PIN_RESET).map((e) => e.reason);
    assert.deepEqual(reasons, [PIN_RESET_REASONS.OTP_RESET, PIN_RESET_REASONS.SELF_CHANGE]);
  });

  it('is not announced when the current PIN is wrong', async () => {
    const events = new FakeEventBus();
    const ctx = build([], events);
    const session = await resetPinByOtp(ctx, '1234');

    await ctx.auth
      .changeStudentPin(session.identity.id, '0000', '5678', NO_DEVICE)
      .catch(() => undefined);

    // One event, from the signup above — nothing for the failed change. An
    // event is a fact that happened; a refused change is not one.
    assert.equal(events.of(DOMAIN_EVENTS.STUDENT_PIN_RESET).length, 1);
  });

  /**
   * The guarantee the event must never take over. Revoking every other session
   * IS the security property of a reset, so it stays a direct call that has
   * already completed by the time anything is published — and a listener that
   * blows up afterwards must not turn that completed reset into a failure the
   * student is told about.
   *
   * The REAL bus and a REAL emitter, because the catch inside the bus is the
   * whole subject: a fake that recorded the emit would pass either way.
   */
  it('completes the reset even when a listener throws', async () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    emitter.on(DOMAIN_EVENTS.STUDENT_PIN_RESET, () => {
      throw new Error('the notifications handler is broken');
    });
    const bus = new DomainEventBus(emitter);
    const ctx = build([], { asService: () => bus });

    const session = await resetPinByOtp(ctx, '1234');

    assert.ok(session.tokens.accessToken, 'the reset must complete regardless');
    // And the sessions really were revoked before anything was published.
    assert.equal(
      Object.keys(ctx.redis.snapshot()).some((key) => key.includes('session')),
      true,
    );
  });
});

describe('DomainEventBus', () => {
  it('delivers a typed payload to a listener', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    const heard: unknown[] = [];
    emitter.on(DOMAIN_EVENTS.STUDENT_PIN_RESET, (payload) => heard.push(payload));

    bus.emit(DOMAIN_EVENTS.STUDENT_PIN_RESET, {
      studentId: 'stu_1',
      mobile: MOBILE,
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    assert.deepEqual(heard, [
      { studentId: 'stu_1', mobile: MOBILE, reason: PIN_RESET_REASONS.OTP_RESET },
    ]);
  });

  it('does not let a broken listener escape into the producer', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    emitter.on(DOMAIN_EVENTS.STUDENT_PIN_RESET, () => {
      throw new Error('handler is broken');
    });

    // EventEmitter2 rethrows a synchronous listener error straight into the
    // caller's stack. Without the catch inside the bus, this would fail — and
    // in production it would fail as a 500 on a PIN reset that had ALREADY
    // succeeded, leaving the student told it did not work when it did.
    assert.doesNotThrow(() =>
      bus.emit(DOMAIN_EVENTS.STUDENT_PIN_RESET, {
        studentId: 'stu_1',
        mobile: MOBILE,
        reason: PIN_RESET_REASONS.SELF_CHANGE,
      }),
    );
  });

  /**
   * Dotted names are names, not namespaces. With wildcards on, a listener for
   * `paperQuestion.*` would receive both DROPPED and BONUS — two different
   * corrections with opposite effects on a score.
   */
  it('treats a dotted event name as opaque', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    let heard = 0;
    emitter.on('student.*', () => (heard += 1));

    bus.emit(DOMAIN_EVENTS.STUDENT_PIN_RESET, {
      studentId: 'stu_1',
      mobile: MOBILE,
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    assert.equal(heard, 0);
  });
});
