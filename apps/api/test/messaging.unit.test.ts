import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { ConsoleMessageSender } from '../src/common/messaging/console-message-sender';
import { SmsMessageSender } from '../src/common/messaging/sms-message-sender';
import { createMessageSender } from '../src/common/messaging/messaging.module';
import { MESSAGE_CHANNELS, MESSAGE_KINDS } from '../src/common/messaging';
import { OtpService } from '../src/auth/otp/otp.service';
import { FakeConfig, FakeMessageSender, FakeRedis } from './support/fakes';

/** The outbound-message seam (docs/03 §10). */

function otpService(config = new FakeConfig()) {
  const sender = new FakeMessageSender();
  const service = new OtpService(new FakeRedis().asService(), config.asService(), sender);
  return { service, sender };
}

describe('OTP as one caller of the message sender', () => {
  it('reaches a student by SMS', async () => {
    const { service, sender } = otpService();

    await service.request(ActorTypes.STUDENT, '9876543210');

    const message = sender.lastMessage;
    assert.equal(message.channel, MESSAGE_CHANNELS.SMS);
    assert.equal(message.kind, MESSAGE_KINDS.OTP);
    assert.equal(message.to, '9876543210');
  });

  it('reaches an admin by email', async () => {
    const { service, sender } = otpService();

    await service.request(ActorTypes.ADMIN, 'admin@iace.co.in');

    assert.equal(sender.lastMessage.channel, MESSAGE_CHANNELS.EMAIL);
    assert.equal(sender.lastMessage.to, 'admin@iace.co.in');
  });

  it('carries the code as a template variable, not only as prose', async () => {
    const { service, sender } = otpService();

    await service.request(ActorTypes.STUDENT, '9876543210');

    // MSG91 fills a DLT-registered template from `data`; it never sends our `body`. A code that only
    // existed in the prose would arrive as an empty template — a message with no code in it.
    const { data, body } = sender.lastMessage;
    assert.match(String(data?.code), /^\d{6}$/);
    assert.equal(data?.ttlSec, 300);
    assert.ok(body.includes(String(data?.code)), 'the rendered body still shows the code');
  });

  it('does not send anything while the resend cooldown is running', async () => {
    const { service, sender } = otpService();
    await service.request(ActorTypes.STUDENT, '9876543210');

    await service.request(ActorTypes.STUDENT, '9876543210').catch(() => undefined);

    assert.equal(sender.sent.length, 1);
  });
});

describe('Provider selection', () => {
  // The factory the module's useFactory calls, exercised directly — the guard is the subject, and
  // standing a Nest container up around it would only add a dependency and a way for the test to
  // pass for the wrong reason.
  const senderFor = (env: Record<string, unknown>) => {
    const config = new FakeConfig(env).asService();
    return createMessageSender(config, new ConsoleMessageSender(), new SmsMessageSender(config));
  };

  it('binds the console sender in development', () => {
    const sender = senderFor({ NODE_ENV: 'development', OTP_SENDER: 'console' });

    assert.ok(sender instanceof ConsoleMessageSender);
  });

  /** The failure this exists to prevent. */
  it('refuses the console sender in production, at boot', () => {
    assert.throws(
      () => senderFor({ NODE_ENV: 'production', OTP_SENDER: 'console' }),
      /not allowed in production/,
    );
  });

  /** A provider selected but not addressed would swallow every OTP silently. */
  it('refuses the SMS sender until it has somewhere to post to', () => {
    assert.throws(
      () => senderFor({ NODE_ENV: 'production', OTP_SENDER: 'sms' }),
      /SMS_PROVIDER_URL/,
    );
  });

  it('binds the SMS sender once the provider is addressed', () => {
    const sender = senderFor({
      NODE_ENV: 'production',
      OTP_SENDER: 'sms',
      SMS_PROVIDER_URL: 'https://sms.example/send',
    });

    assert.ok(sender instanceof SmsMessageSender);
  });
});
