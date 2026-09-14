import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import { DOMAIN_EVENTS, PIN_RESET_REASONS } from '../src/common/events';

/** The event seam (docs/03 §6). The announcements a PIN reset makes are asserted in auth-service.db. */

const MOBILE = '9876543210';

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

    // EventEmitter2 rethrows a synchronous listener error straight into the caller's stack.
    assert.doesNotThrow(() =>
      bus.emit(DOMAIN_EVENTS.STUDENT_PIN_RESET, {
        studentId: 'stu_1',
        mobile: MOBILE,
        reason: PIN_RESET_REASONS.SELF_CHANGE,
      }),
    );
  });

  /** Dotted names are names, not namespaces: a `student.*` listener must hear no student event. */
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
