import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { InteraktMessageSender } from '../src/common/messaging/interakt-message-sender';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MessageNotConfiguredError,
  type OutboundMessage,
} from '../src/common/messaging';
import { FakeConfig } from './support/fakes';

const CONFIGURED = {
  WHATSAPP_TEMPLATE_LANGUAGE: 'en',
  WHATSAPP_INTERAKT_URL: 'https://api.interakt.ai/v1/public/message/',
  WHATSAPP_INTERAKT_API_KEY: 'interakt-key',
  WHATSAPP_TEMPLATE_OTP: 'iace_login_code',
  WHATSAPP_TEMPLATE_RESULT_READY: '',
};

const interakt = (env: Record<string, unknown> = CONFIGURED) =>
  new InteraktMessageSender(new FakeConfig(env).asService());

function message(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    channel: MESSAGE_CHANNELS.WHATSAPP,
    kind: MESSAGE_KINDS.OTP,
    to: '9876543210',
    actor: ActorTypes.STUDENT,
    body: '123456 is your IACE verification code.',
    data: { code: '123456' },
    ...over,
  };
}

interface Captured {
  url: string;
  body: Record<string, unknown>;
  auth: string | undefined;
}

const realFetch = globalThis.fetch;

/** Records what would have gone out, and answers however the test says the provider did. */
function capture(status = 200, payload: unknown = { result: true, id: 'msg-1' }) {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      auth: headers.authorization,
    });
    return { ok: status < 400, status, json: () => Promise.resolve(payload) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('InteraktMessageSender', () => {
  it('posts the approved template and its positional values under Interakt field names', async () => {
    const calls = capture();

    await interakt().send(message());

    const sent = calls[0];
    assert.equal(sent?.url, CONFIGURED.WHATSAPP_INTERAKT_URL);
    assert.equal(sent?.auth, 'Basic interakt-key');
    assert.equal(sent?.body.countryCode, '+91');
    assert.equal(sent?.body.phoneNumber, '9876543210');
    assert.deepEqual(sent?.body.template, {
      name: 'iace_login_code',
      languageCode: 'en',
      bodyValues: ['123456'],
      buttonValues: { '0': ['123456'] },
    });
  });

  /** Prevents reading a refusal inside a 200 as sent, which would skip the SMS fallback. */
  it('treats a refusal inside a 200 as a failure', async () => {
    capture(200, { result: false, message: 'Template not approved' });

    await assert.rejects(interakt().send(message()), /Template not approved/);
  });

  it('fails loudly on a refusal, so the caller can fall back', async () => {
    capture(429);

    await assert.rejects(interakt().send(message()), /429/);
  });

  /** The number is stored ten digits, and Interakt wants it dialled — however it was typed. */
  it('dials the stored number', async () => {
    const calls = capture();

    await interakt().send(message({ to: '+91 98765 43210' }));

    assert.equal(calls[0]?.body.countryCode, '+91');
    assert.equal(calls[0]?.body.phoneNumber, '9876543210');
  });

  it('refuses a channel it does not speak', async () => {
    await assert.rejects(
      interakt().send(message({ channel: MESSAGE_CHANNELS.SMS })),
      /handed a sms message/,
    );
  });
});

describe('A kind with no approved template', () => {
  /** Nobody signs in without an OTP, so a missing template is fatal rather than quiet. */
  it('is fatal for a kind nobody gets in without', async () => {
    capture();

    await assert.rejects(
      interakt({ ...CONFIGURED, WHATSAPP_TEMPLATE_OTP: undefined }).send(message()),
      /No WhatsApp template is configured for "otp"/,
    );
  });

  /** Off, not broken — but the caller is TOLD, or it would record a message nobody sent as sent. */
  it('is off for every other kind, and says so rather than resolving', async () => {
    const calls = capture();

    await assert.rejects(
      interakt().send(message({ kind: MESSAGE_KINDS.RESULT_READY, data: { testId: 'tst_1' } })),
      MessageNotConfiguredError,
    );

    assert.equal(calls.length, 0);
  });
});
