import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OTP_CHANNELS } from '@iace/contracts';
import { resendSays, sentSays } from '../src/login-steps';

describe('sentSays — where the code went', () => {
  it('names the channel, so a student knows which app to look in', () => {
    assert.equal(
      sentSays({ channel: OTP_CHANNELS.WHATSAPP }, '9876543210'),
      'Sent by WhatsApp to +91 9876543210',
    );
  });

  it('says only where when the server named no channel', () => {
    assert.equal(sentSays({}, '9876543210'), 'Sent to +91 9876543210');
  });
});

describe('resendSays — asking again', () => {
  /** The failure this prevents: a button promising a second send down the channel that just failed. */
  it('offers the other channel where there is one, and the wait before it', () => {
    assert.equal(resendSays(32, OTP_CHANNELS.SMS), 'Send by SMS in 32s');
    assert.equal(resendSays(0, OTP_CHANNELS.SMS), 'Send by SMS');
  });

  it('offers the same again where there is only one', () => {
    assert.equal(resendSays(5, undefined), 'Send again in 5s');
    assert.equal(resendSays(0, undefined), 'Send again');
  });
});
