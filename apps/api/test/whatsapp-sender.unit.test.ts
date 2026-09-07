import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { WhatsAppCloudMessageSender } from '../src/common/messaging/whatsapp-cloud-message-sender';
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
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: '106540352242922',
  WHATSAPP_CLOUD_ACCESS_TOKEN: 'system-user-token',
  WHATSAPP_CLOUD_API_VERSION: 'v23.0',
  WHATSAPP_INTERAKT_URL: 'https://api.interakt.ai/v1/public/message/',
  WHATSAPP_INTERAKT_API_KEY: 'interakt-key',
  WHATSAPP_TEMPLATE_OTP: 'iace_login_code',
  WHATSAPP_TEMPLATE_RESULT_READY: '',
};

const cloud = (env: Record<string, unknown> = CONFIGURED) =>
  new WhatsAppCloudMessageSender(new FakeConfig(env).asService());

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

describe('WhatsAppCloudMessageSender', () => {
  it('posts the approved template and its positional values to the number it belongs to', async () => {
    const calls = capture();

    await cloud().send(message());

    const sent = calls[0];
    assert.equal(
      sent?.url,
      'https://graph.facebook.com/v23.0/106540352242922/messages',
      'the phone number id and pinned api version are both in the path',
    );
    assert.equal(sent?.auth, 'Bearer system-user-token');
    assert.deepEqual(sent?.body.template, {
      name: 'iace_login_code',
      language: { code: 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
        {
          type: 'button',
          sub_type: 'copy_code',
          index: '0',
          parameters: [{ type: 'text', text: '123456' }],
        },
      ],
    });
  });

  /** Meta rejects an authentication template whose button is not given the code the body carries. */
  it('repeats the code in the copy-code button', async () => {
    const calls = capture();

    await cloud().send(message());

    const components = (calls[0]?.body.template as { components: { type: string }[] }).components;
    assert.equal(components.length, 2);
    assert.equal(components[1]?.type, 'button');
  });

  /** The number is stored ten digits, and Meta wants it dialled — however it was typed. */
  it('dials the stored number', async () => {
    const calls = capture();

    await cloud().send(message({ to: '+91 98765 43210' }));

    assert.equal(calls[0]?.body.to, '919876543210');
  });

  it('fails loudly on a refusal, so the caller can fall back', async () => {
    capture(401);

    await assert.rejects(cloud().send(message()), /401/);
  });

  it('refuses a channel it does not speak', async () => {
    await assert.rejects(
      cloud().send(message({ channel: MESSAGE_CHANNELS.SMS })),
      /handed a sms message/,
    );
  });
});

describe('InteraktMessageSender', () => {
  it('posts the same template under Interakt field names', async () => {
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
});

describe('A kind with no approved template', () => {
  /** Nobody signs in without an OTP, so a missing template is fatal rather than quiet. */
  it('is fatal for a kind nobody gets in without', async () => {
    capture();

    await assert.rejects(
      cloud({ ...CONFIGURED, WHATSAPP_TEMPLATE_OTP: undefined }).send(message()),
      /No WhatsApp template is configured for "otp"/,
    );
  });

  /** Off, not broken — but the caller is TOLD, or it would record a message nobody sent as sent. */
  it('is off for every other kind, and says so rather than resolving', async () => {
    const calls = capture();

    await assert.rejects(
      cloud().send(message({ kind: MESSAGE_KINDS.RESULT_READY, data: { testId: 'tst_1' } })),
      MessageNotConfiguredError,
    );

    assert.equal(calls.length, 0);
  });
});
