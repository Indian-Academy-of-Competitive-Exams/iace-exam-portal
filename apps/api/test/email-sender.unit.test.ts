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
  SMTP_HOST: 'smtp.example',
  SMTP_PORT: 587,
  SMTP_USER: 'iace',
  SMTP_PASSWORD: 'secret',
  SMTP_FROM: 'no-reply@iace.co.in',
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
  it('sends from the configured address, with the subject the caller wrote', async () => {
    const { built, posted } = sender();

    await built.send(message());

    assert.deepEqual(posted[0], {
      from: 'no-reply@iace.co.in',
      to: 'admin@iace.co.in',
      subject: 'Your IACE verification code',
      text: '123456 is your IACE verification code.',
    });
  });

  /** A student's OTP arriving at an SMTP relay would be a message nobody ever reads. */
  it('refuses a channel it cannot deliver', async () => {
    const { built, posted } = sender();

    await assert.rejects(built.send(message({ channel: MESSAGE_CHANNELS.SMS })), /sms/);
    assert.equal(posted.length, 0);
  });

  /** Selected but not addressed is a misconfiguration, and silence is the wrong way to report it. */
  it('says which variable is missing rather than failing obscurely', async () => {
    const unaddressed = new EmailMessageSender(new FakeConfig({}).asService());

    await assert.rejects(unaddressed.send(message()), /SMTP_HOST/);
  });
});

describe('RoutedMessageSender', () => {
  const both = () => {
    const sms = new FakeMessageSender();
    const email = new FakeMessageSender();
    return { sms, email, routed: new RoutedMessageSender(sms, email) };
  };

  /** A student is reached by SMS and an admin by email, which is the whole reason this exists. */
  it('sends each channel to the provider that speaks it', async () => {
    const { sms, email, routed } = both();

    await routed.send(message({ channel: MESSAGE_CHANNELS.SMS, to: '9876543210' }));
    await routed.send(message());

    assert.equal(sms.lastMessage.to, '9876543210');
    assert.equal(email.lastMessage.to, 'admin@iace.co.in');
  });

  /** An in-app notification is a row somebody reads, never a message anybody sends. */
  it('refuses a channel nothing delivers', async () => {
    const { routed } = both();

    await assert.rejects(
      (routed as MessageSender).send(message({ channel: MESSAGE_CHANNELS.IN_APP })),
      /in_app/,
    );
  });
});
