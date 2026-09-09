import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { ACTION_MARGIN_SEC, escalationFor } from '../src/notifications/notification-policy';

const NOW = new Date('2026-06-01T10:00:00.000Z');
const MINUTE = 60 * 1000;
const inMinutes = (n: number) => new Date(NOW.getTime() + n * MINUTE);

/** The whole realignment: in-app and web push are the surface, and money is a per-send choice. */
const CHOSEN = [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS];

describe('What a notification is worth spending on', () => {
  it('escalates no kind by default, however urgent the kind sounds', () => {
    for (const type of Object.values(NOTIFICATION_TYPE)) {
      assert.deepEqual(escalationFor(type, inMinutes(1), NOW).channels, [], type);
    }
  });

  /** WhatsApp carries a tappable link; a DLT template cannot, so SMS is the later resort. */
  it('honours the order an admin chose for one send', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.GENERIC, null, NOW, CHOSEN);

    assert.deepEqual(plan.channels, [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS]);
  });

  /** SMS stays reachable for an announcement an admin pays for; no KIND reaches for it. */
  it('never reaches SMS without being told to', () => {
    const chains = Object.values(NOTIFICATION_TYPE).flatMap(
      (type) => escalationFor(type, null, NOW).channels,
    );

    assert.equal(chains.includes(DeliveryChannel.SMS), false);
  });
});

describe('When a notification stops waiting', () => {
  /** The common case, and the one the whole grace window exists for. */
  it('waits out the window when nothing expires', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.RESULT_READY, null, NOW, CHOSEN);

    assert.equal(plan.deferSec, 600);
  });

  it('still waits when the deadline is comfortably far off', () => {
    const plan = escalationFor(
      NOTIFICATION_TYPE.TEST_ASSIGNED,
      inMinutes(60 * 24 * 3),
      NOW,
      CHOSEN,
    );

    assert.equal(plan.deferSec, 600, 'a test three days out is not a reason to pay now');
  });

  /** Prevents telling a student about a test that started while the window was still running. */
  it('pays immediately when waiting would eat the time to act', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(20), NOW, CHOSEN);

    assert.equal(plan.deferSec, 0);
  });

  it('pays immediately for a deadline that has already passed', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(-5), NOW, CHOSEN);

    assert.equal(plan.deferSec, 0);
  });

  /** Rating by KIND would have to assume the worst case here and pay every time. */
  it('gives the same kind opposite answers on either side of the margin', () => {
    const margin = ACTION_MARGIN_SEC / 60;
    const near = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(margin + 5), NOW, CHOSEN);
    const far = escalationFor(NOTIFICATION_TYPE.TEST_ASSIGNED, inMinutes(margin + 60), NOW, CHOSEN);

    assert.equal(near.deferSec, 0);
    assert.equal(far.deferSec, 600);
  });

  /** Nothing to buy is nothing to wait for: a deferral would only delay a job that does nothing. */
  it('does not wait at all when nothing will be bought', () => {
    const plan = escalationFor(NOTIFICATION_TYPE.RESULT_READY, null, NOW);

    assert.equal(plan.deferSec, 0);
  });
});
