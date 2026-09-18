import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageFor, outcomeOf } from '../src/notifications/fcm.sender';
import { PUSH_OUTCOMES } from '../src/notifications/web-push.sender';

const PAYLOAD = { title: 'Your result is ready', url: '/notifications', notificationId: 'ntf_1' };

const refusal = (errorCode: string, status = 'INVALID_ARGUMENT') =>
  JSON.stringify({ error: { status, details: [{ errorCode }] } });

describe('The message FCM is sent', () => {
  /** The whole payload rule: a locked phone renders this, so it carries no score and no answer. */
  it('names the title and the way in, and nothing about the result', () => {
    const { message } = messageFor('fcm-one', PAYLOAD) as {
      message: { notification: object; data: object; token: string };
    };

    assert.equal(message.token, 'fcm-one');
    assert.deepEqual(message.notification, { title: 'Your result is ready' });
    assert.deepEqual(message.data, { url: '/notifications', notificationId: 'ntf_1' });
  });

  /** Six hours: long enough to reach a phone that is asleep, short enough not to land stale. */
  it('expires rather than queueing behind a phone that never comes back', () => {
    const { message } = messageFor('fcm-one', PAYLOAD) as { message: { android: { ttl: string } } };

    assert.equal(message.android.ttl, '21600s');
  });
});

describe('What FCM answered', () => {
  it('reads a retired token as gone, whichever way FCM says it', () => {
    assert.equal(outcomeOf(404, ''), PUSH_OUTCOMES.GONE);
    assert.equal(outcomeOf(400, refusal('UNREGISTERED')), PUSH_OUTCOMES.GONE);
    assert.equal(outcomeOf(403, refusal('SENDER_ID_MISMATCH')), PUSH_OUTCOMES.GONE);
  });

  /** Everything else is worth keeping the row for: the token may be fine and the service not. */
  it('keeps the device on anything that is not the token being dead', () => {
    assert.equal(outcomeOf(500, ''), PUSH_OUTCOMES.FAILED);
    assert.equal(outcomeOf(429, ''), PUSH_OUTCOMES.FAILED);
    assert.equal(outcomeOf(401, refusal('UNREGISTERED')), PUSH_OUTCOMES.FAILED);
    assert.equal(
      outcomeOf(400, refusal('QUOTA_EXCEEDED', 'RESOURCE_EXHAUSTED')),
      PUSH_OUTCOMES.FAILED,
    );
  });

  /** A body that is not JSON is a proxy answering, not FCM — which is not the token's fault. */
  it('keeps the device when the answer cannot be read at all', () => {
    assert.equal(outcomeOf(400, '<html>Bad Request</html>'), PUSH_OUTCOMES.FAILED);
  });
});
