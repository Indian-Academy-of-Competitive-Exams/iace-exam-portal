import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { ACTION_MARGIN_SEC, escalationFor } from '../src/notifications/notification-policy';

const NOW = new Date('2026-06-01T10:00:00.000Z');
const MINUTE = 60 * 1000;
const inMinutes = (n: number) => new Date(NOW.getTime() + n * MINUTE);

describe('What a notification is worth spending on', () => {
  /** The bell is the whole of it: access a student did not ask for never justifies a paid message. */
  it('never escalates a kind with no paid channels', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.ENROLLMENT_ADDED, inMinutes(1), NOW);

    assert.deepEqual(plan.channels, []);
  });

  /** WhatsApp carries a tappable link; a DLT template cannot, so SMS is the later resort. */
  it('reaches for WhatsApp before SMS', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, null, NOW);

    assert.deepEqual(plan.channels, [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS]);
  });
});

describe('When a notification stops waiting', () => {
  /** The common case, and the one the whole grace window exists for. */
  it('waits out the window when nothing expires', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.RESULT_READY, null, NOW);

    assert.equal(plan.deferSec, 600);
  });

  it('still waits when the deadline is comfortably far off', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(60 * 24 * 3), NOW);

    assert.equal(plan.deferSec, 600, 'a test three days out is not a reason to pay now');
  });

  /** Prevents telling a student about a test that started while the window was still running. */
  it('pays immediately when waiting would eat the time to act', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(20), NOW);

    assert.equal(plan.deferSec, 0);
  });

  it('pays immediately for a deadline that has already passed', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(-5), NOW);

    assert.equal(plan.deferSec, 0);
  });

  /** Rating by KIND would have to assume the worst case here and pay every time. */
  it('gives the same kind opposite answers on either side of the margin', () => {
    const margin = ACTION_MARGIN_SEC / 60;
    const near = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(margin + 5), NOW);
    const far = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(margin + 60), NOW);

    assert.equal(near.deferSec, 0);
    assert.equal(far.deferSec, 600);
  });
});
