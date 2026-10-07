import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventBus } from '../src/common/events/domain-event-bus';
import { DOMAIN_EVENTS } from '../src/common/events';

/** The event seam (docs/03 §6). What a signup announces is asserted in auth-service.db. */

describe('DomainEventBus', () => {
  it('delivers a typed payload to a listener', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    const heard: unknown[] = [];
    emitter.on(DOMAIN_EVENTS.STUDENT_SIGNED_UP, (payload) => heard.push(payload));

    bus.emit(DOMAIN_EVENTS.STUDENT_SIGNED_UP, { studentId: 'stu_1' });

    assert.deepEqual(heard, [{ studentId: 'stu_1' }]);
  });

  it('does not let a broken listener escape into the producer', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    emitter.on(DOMAIN_EVENTS.STUDENT_SIGNED_UP, () => {
      throw new Error('handler is broken');
    });

    // EventEmitter2 rethrows a synchronous listener error straight into the caller's stack.
    assert.doesNotThrow(() => bus.emit(DOMAIN_EVENTS.STUDENT_SIGNED_UP, { studentId: 'stu_1' }));
  });

  /** Dotted names are names, not namespaces: a `student.*` listener must hear no student event. */
  it('treats a dotted event name as opaque', () => {
    const emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    const bus = new DomainEventBus(emitter);
    let heard = 0;
    emitter.on('student.*', () => (heard += 1));

    bus.emit(DOMAIN_EVENTS.STUDENT_SIGNED_UP, { studentId: 'stu_1' });

    assert.equal(heard, 0);
  });
});
