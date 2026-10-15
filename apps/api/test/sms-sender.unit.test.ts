import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Logger } from '@nestjs/common';
import { ActorTypes } from '@iace/contracts';
import { SmsMessageSender } from '../src/common/messaging/sms-message-sender';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MessageNotConfiguredError,
  type OutboundMessage,
} from '../src/common/messaging';
import { FakeConfig } from './support/fakes';

const CONFIGURED = {
  SMS_PROVIDER_URL: 'http://sms.example/MOBILE_APPS_API/sms_api.php',
  SMS_PROVIDER_USER: 'iace',
  SMS_PROVIDER_PASS: 'pass-123',
  SMS_SENDER_ID: 'IACEIN',
  SMS_TEMPLATE_OTP: '1207000000000000001',
};

const REGISTERED_OTP =
  'Your OTP for IACE Login is 123456. This OTP is valid for 5 minutes. Do not share this OTP with anyone. Indian Academy of Competitive Exams.';

const sender = (env: Record<string, unknown> = CONFIGURED) =>
  new SmsMessageSender(new FakeConfig(env).asService());

function message(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    channel: MESSAGE_CHANNELS.SMS,
    kind: MESSAGE_KINDS.OTP,
    to: '9876543210',
    actor: ActorTypes.STUDENT,
    body: '123456 is your IACE verification code.',
    data: { code: '123456', ttlSec: 300 },
    ...over,
  };
}

const realFetch = globalThis.fetch;

/** Records what would have gone out, and answers however the test says the gateway did. */
function capture(answer = 'SMS-SHOOT-ID/iace123', status = 200) {
  const calls: URL[] = [];
  globalThis.fetch = (async (url: URL) => {
    calls.push(new URL(url));
    return { ok: status < 400, status, text: async () => answer } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

describe('SmsMessageSender', () => {
  it('sends the registered text with the code in it, beside its template id', async () => {
    const calls = capture();

    await sender().send(message());

    assert.equal(calls.length, 1);
    const [url] = calls;
    assert.ok(url);
    assert.equal(`${url.origin}${url.pathname}`, CONFIGURED.SMS_PROVIDER_URL);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      type: 'smsquicksend',
      user: 'iace',
      pass: 'pass-123',
      sender: 'IACEIN',
      to_mobileno: '9876543210',
      sms_text: REGISTERED_OTP,
      t_id: '1207000000000000001',
    });
  });

  /** The URL carries the password, so what is logged is the gateway's answer, never the request. */
  it('logs the gateway answer without the password', async () => {
    capture();
    const logged: string[] = [];
    mock.method(Logger.prototype, 'log', (line: string) => logged.push(line));

    await sender().send(message());

    const [line = ''] = logged;
    assert.equal(logged.length, 1);
    assert.match(line, /SMS-SHOOT-ID\/iace123/);
    assert.doesNotMatch(line, /pass-123|9876543210/);
  });

  /** The gateway answers 200 to a refusal, so the body is what says whether a code went out. */
  it('raises a send the gateway refused with ERROR, though it answered 200', async () => {
    capture('ERROR: Invalid template');

    await assert.rejects(sender().send(message()), /Invalid template/);
  });

  it('raises an HTTP failure from the gateway', async () => {
    capture('Bad Gateway', 502);

    await assert.rejects(sender().send(message()), /502/);
  });

  /** Off, not broken — but the caller is TOLD, or it would record a message nobody sent as sent. */
  it('does not send a kind with no registered template', async () => {
    const calls = capture();

    await assert.rejects(
      sender({ ...CONFIGURED, SMS_TEMPLATE_RESULT_READY: '1207' }).send(
        message({ kind: MESSAGE_KINDS.RESULT_READY }),
      ),
      MessageNotConfiguredError,
    );

    assert.equal(calls.length, 0);
  });

  /** Silence is fine for an announcement and fatal for a credential: somebody is waiting on it. */
  it('refuses to silently drop an OTP', async () => {
    const calls = capture();
    const unconfigured = sender({ ...CONFIGURED, SMS_TEMPLATE_OTP: undefined });

    await assert.rejects(unconfigured.send(message()), /template/);
    assert.equal(calls.length, 0);
  });
});
