import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { EmailMessageSender } from '../src/common/messaging/email-message-sender';
import { RoutedMessageSender } from '../src/common/messaging/routed-message-sender';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  type MessageSender,
  type OutboundMessage,
} from '../src/common/messaging';
import { FakeConfig, FakeMessageSender } from './support/fakes';

const CONFIGURED = {
  MAIL_USER: 'no-reply@iace.co.in',
  MAIL_PASSWORD: 'abcd efgh ijkl mnop',
};

function message(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    channel: MESSAGE_CHANNELS.EMAIL,
    kind: MESSAGE_KINDS.OTP,
    to: 'admin@iace.co.in',
    actor: ActorTypes.ADMIN,
    subject: 'Your IACE verification code',
    body: '123456 is your IACE verification code.',
    ...over,
  };
}

/** Replaces the transport nodemailer would have built, so nothing opens a socket. */
function sender(env: Record<string, unknown> = CONFIGURED) {
  const posted: Record<string, unknown>[] = [];
  const built = new EmailMessageSender(new FakeConfig(env).asService());
  const withTransport = built as unknown as {
    transport: { sendMail: (mail: Record<string, unknown>) => Promise<void> } | null;
  };
  withTransport.transport = {
    sendMail: (mail) => {
      posted.push(mail);
      return Promise.resolve();
    },
  };
  return { built, posted };
}

describe('EmailMessageSender', () => {
  it('sends from the authenticated account, with the subject the caller wrote', async () => {
    const { built, posted } = sender();

    await built.send(message());

    assert.deepEqual(posted[0], {
      from: 'no-reply@iace.co.in',
      to: 'admin@iace.co.in',
      subject: 'Your IACE verification code',
      text: '123456 is your IACE verification code.',
    });
  });

  /** A student's OTP arriving in a mailbox would be a message nobody ever reads. */
  it('refuses a channel it cannot deliver', async () => {
    const { built, posted } = sender();

    await assert.rejects(built.send(message({ channel: MESSAGE_CHANNELS.SMS })), /sms/);
    assert.equal(posted.length, 0);
  });

  /** Selected but not addressed is a misconfiguration, and silence is the wrong way to report it. */
  it('says which variable is missing rather than failing obscurely', async () => {
    const unaddressed = new EmailMessageSender(new FakeConfig({}).asService());

    await assert.rejects(unaddressed.send(message()), /MAIL_USER/);
  });

  /** Gmail takes no unauthenticated connection, so a user without its app password cannot send. */
  it('refuses an account with no app password', async () => {
    const halfSet = new EmailMessageSender(
      new FakeConfig({ MAIL_USER: 'no-reply@iace.co.in' }).asService(),
    );

    await assert.rejects(halfSet.send(message()), /MAIL_PASSWORD/);
  });
});

describe('RoutedMessageSender', () => {
  const all = () => {
    const sms = new FakeMessageSender();
    const email = new FakeMessageSender();
    const whatsapp = new FakeMessageSender();
    const routed = new RoutedMessageSender({
      [MESSAGE_CHANNELS.SMS]: sms,
      [MESSAGE_CHANNELS.EMAIL]: email,
      [MESSAGE_CHANNELS.WHATSAPP]: whatsapp,
    });
    return { sms, email, whatsapp, routed };
  };

  /** A student is reached by WhatsApp or SMS and an admin by email — the whole reason this exists. */
  it('sends each channel to the provider that speaks it', async () => {
    const { sms, email, whatsapp, routed } = all();

    await routed.send(message({ channel: MESSAGE_CHANNELS.SMS, to: '9876543210' }));
    await routed.send(message({ channel: MESSAGE_CHANNELS.WHATSAPP, to: '9812345678' }));
    await routed.send(message());

    assert.equal(sms.lastMessage.to, '9876543210');
    assert.equal(whatsapp.lastMessage.to, '9812345678');
    assert.equal(email.lastMessage.to, 'admin@iace.co.in');
  });

  /** An in-app notification is a row somebody reads, never a message anybody sends. */
  it('refuses a channel nothing delivers', async () => {
    const { routed } = all();

    await assert.rejects(
      (routed as MessageSender).send(message({ channel: MESSAGE_CHANNELS.IN_APP })),
      /in_app/,
    );
  });

  /** WhatsApp switched off must route nowhere, rather than fall through to a provider that lies. */
  it('refuses WhatsApp when nobody is carrying it', async () => {
    const routed = new RoutedMessageSender({
      [MESSAGE_CHANNELS.SMS]: new FakeMessageSender(),
      [MESSAGE_CHANNELS.EMAIL]: new FakeMessageSender(),
    });

    await assert.rejects(routed.send(message({ channel: MESSAGE_CHANNELS.WHATSAPP })), /whatsapp/);
  });
});
