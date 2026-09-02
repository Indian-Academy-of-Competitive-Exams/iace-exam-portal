import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { SmsMessageSender } from '../src/common/messaging/sms-message-sender';
import { MESSAGE_CHANNELS, MESSAGE_KINDS, type OutboundMessage } from '../src/common/messaging';
import { FakeConfig } from './support/fakes';

const CONFIGURED = {
  SMS_PROVIDER_URL: 'https://sms.example/send',
  SMS_PROVIDER_KEY: 'key-123',
  SMS_SENDER_ID: 'IACEIN',
  SMS_TEMPLATE_OTP: 'dlt-otp',
  SMS_TEMPLATE_PIN: 'dlt-pin',
};

const sender = (env: Record<string, unknown> = CONFIGURED) =>
  new SmsMessageSender(new FakeConfig(env).asService());

function message(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    channel: MESSAGE_CHANNELS.SMS,
    kind: MESSAGE_KINDS.OTP,
    to: '9876543210',
    actor: ActorTypes.STUDENT,
    body: '123456 is your IACE verification code.',
    data: { code: '123456' },
    ...over,
  };
}

const realFetch = globalThis.fetch;

/** Records what would have gone out, and answers however the test says the provider did. */
function capture(status = 200) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      auth: headers.authorization,
    });
    return { ok: status < 400, status } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SmsMessageSender', () => {
  it('posts the registered template and its variables, never our prose', async () => {
    const calls = capture();

    await sender().send(message());

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, CONFIGURED.SMS_PROVIDER_URL);
    assert.equal(calls[0]?.auth, CONFIGURED.SMS_PROVIDER_KEY);
    assert.deepEqual(calls[0]?.body, {
      to: '9876543210',
      templateId: 'dlt-otp',
      senderId: 'IACEIN',
      variables: { code: '123456' },
    });
  });

  /** Turning a message on is registering its template — a code change would defeat the point. */
  it('does not send an announcement whose template nobody has registered', async () => {
    const calls = capture();

    await sender().send(message({ kind: MESSAGE_KINDS.RESULT_READY }));

    assert.equal(calls.length, 0);
  });

  /** Silence is fine for an announcement and fatal for a credential: somebody is waiting on it. */
  it('refuses to silently drop an OTP or a PIN', async () => {
    capture();
    const unconfigured = sender({ ...CONFIGURED, SMS_TEMPLATE_OTP: undefined });

    await assert.rejects(unconfigured.send(message()), /template/);
    await assert.rejects(
      sender({ ...CONFIGURED, SMS_TEMPLATE_PIN: undefined }).send(
        message({ kind: MESSAGE_KINDS.PIN }),
      ),
      /template/,
    );
  });

  it('raises what the provider refused, so a caller can log or retry it', async () => {
    capture(502);

    await assert.rejects(sender().send(message()), /502/);
  });

  /** An admin's OTP goes by email, and no email provider exists — say so rather than post it to SMS. */
  it('refuses a channel it cannot deliver', async () => {
    const calls = capture();

    await assert.rejects(
      sender().send(message({ channel: MESSAGE_CHANNELS.EMAIL, to: 'admin@iace.co.in' })),
      /SMTP/,
    );
    assert.equal(calls.length, 0);
  });
});
