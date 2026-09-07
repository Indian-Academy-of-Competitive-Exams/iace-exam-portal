import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes } from '@iace/contracts';
import { ConsoleMessageSender } from '../src/common/messaging/console-message-sender';
import { SmsMessageSender } from '../src/common/messaging/sms-message-sender';
import { EmailMessageSender } from '../src/common/messaging/email-message-sender';
import { WhatsAppCloudMessageSender } from '../src/common/messaging/whatsapp-cloud-message-sender';
import { InteraktMessageSender } from '../src/common/messaging/interakt-message-sender';
import { RoutedMessageSender } from '../src/common/messaging/routed-message-sender';
import {
  createMessageSender,
  createWhatsAppSender,
} from '../src/common/messaging/messaging.module';
import { MESSAGE_CHANNELS, MESSAGE_KINDS } from '../src/common/messaging';
import { OtpService } from '../src/auth/otp/otp.service';
import { FakeConfig, FakeMessageSender, FakeRedis } from './support/fakes';

/** The outbound-message seam (docs/03 §10). */

function otpService(config = new FakeConfig(), sender = new FakeMessageSender()) {
  const service = new OtpService(new FakeRedis().asService(), config.asService(), sender);
  return { service, sender };
}

/** A deployment that has done the whole WhatsApp-first setup, SMS fallback included. */
const WHATSAPP_READY = {
  NODE_ENV: 'production',
  OTP_SENDER: 'whatsapp',
  SMS_PROVIDER_URL: 'https://sms.example/send',
  MAIL_USER: 'no-reply@iace.co.in',
  MAIL_PASSWORD: 'abcd efgh ijkl mnop',
  WHATSAPP_PROVIDER: 'interakt',
  WHATSAPP_INTERAKT_API_KEY: 'interakt-key',
  WHATSAPP_TEMPLATE_OTP: 'iace_login_code',
};

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
    return createMessageSender(
      config,
      new ConsoleMessageSender(),
      new SmsMessageSender(config),
      new EmailMessageSender(config),
      new WhatsAppCloudMessageSender(config),
      new InteraktMessageSender(config),
    );
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

  /** An admin signs in by email, so a deployment with no mail account cannot let anybody in. */
  it('refuses to boot with SMS configured and email not', () => {
    assert.throws(
      () =>
        senderFor({
          NODE_ENV: 'production',
          OTP_SENDER: 'sms',
          SMS_PROVIDER_URL: 'https://sms.example/send',
        }),
      /MAIL_USER/,
    );
  });

  it('routes by channel once both providers are addressed', () => {
    const sender = senderFor({
      NODE_ENV: 'production',
      OTP_SENDER: 'sms',
      SMS_PROVIDER_URL: 'https://sms.example/send',
      MAIL_USER: 'no-reply@iace.co.in',
      MAIL_PASSWORD: 'abcd efgh ijkl mnop',
    });

    assert.ok(sender instanceof RoutedMessageSender);
  });

  /** Prevents a WhatsApp-first deployment with no way back in when Meta throttles the number. */
  it('refuses WhatsApp-first OTP unless SMS is configured to fall back to', () => {
    assert.throws(
      () => senderFor({ ...WHATSAPP_READY, SMS_PROVIDER_URL: undefined }),
      /SMS_PROVIDER_URL/,
    );
  });

  it('refuses WhatsApp-first OTP when nobody is carrying WhatsApp', () => {
    assert.throws(
      () => senderFor({ ...WHATSAPP_READY, WHATSAPP_PROVIDER: 'none' }),
      /WHATSAPP_PROVIDER/,
    );
  });

  it('refuses the chosen WhatsApp provider until it has credentials', () => {
    assert.throws(
      () => senderFor({ ...WHATSAPP_READY, WHATSAPP_INTERAKT_API_KEY: undefined }),
      /WHATSAPP_INTERAKT_API_KEY/,
    );
  });

  /** A template nobody registered would send an OTP nobody receives, silently. */
  it('refuses WhatsApp-first OTP with no approved template to send', () => {
    assert.throws(
      () => senderFor({ ...WHATSAPP_READY, WHATSAPP_TEMPLATE_OTP: undefined }),
      /WHATSAPP_TEMPLATE_OTP/,
    );
  });

  it('routes WhatsApp once the whole chain is configured', () => {
    assert.ok(senderFor(WHATSAPP_READY) instanceof RoutedMessageSender);
  });
});

describe('Which vendor carries WhatsApp', () => {
  const chosen = (env: Record<string, unknown>) => {
    const config = new FakeConfig(env).asService();
    return createWhatsAppSender(
      config,
      new WhatsAppCloudMessageSender(config),
      new InteraktMessageSender(config),
    );
  };

  /** Leaving Interakt is a restart, not a rewrite — which only holds if both are wired at once. */
  it('picks Meta direct or Interakt from config alone', () => {
    assert.ok(chosen({ WHATSAPP_PROVIDER: 'cloud' }) instanceof WhatsAppCloudMessageSender);
    assert.ok(chosen({ WHATSAPP_PROVIDER: 'interakt' }) instanceof InteraktMessageSender);
  });

  it('carries nothing when WhatsApp is off', () => {
    assert.equal(chosen({ WHATSAPP_PROVIDER: 'none' }), undefined);
  });
});

describe('OTP falls back rather than stranding a student', () => {
  const whatsappFirst = () => new FakeConfig({ OTP_SENDER: 'whatsapp' });

  it('reaches a student on WhatsApp when that is the configured channel', async () => {
    const { service, sender } = otpService(whatsappFirst());

    await service.request(ActorTypes.STUDENT, '9876543210');

    assert.equal(sender.lastMessage.channel, MESSAGE_CHANNELS.WHATSAPP);
  });

  /** The behaviour the fallback exists for: one code, on whichever channel will take it. */
  it('sends the same code by SMS when WhatsApp will not take it', async () => {
    const failing = new FakeMessageSender([MESSAGE_CHANNELS.WHATSAPP]);
    const { service } = otpService(whatsappFirst(), failing);

    await service.request(ActorTypes.STUDENT, '9876543210');

    assert.equal(failing.sent.length, 1);
    assert.equal(failing.lastMessage.channel, MESSAGE_CHANNELS.SMS);
    assert.match(failing.lastCode, /^\d{6}$/);
  });

  /** Not a blanket catch: SMS is the last resort, so its failure is still a failed request. */
  it('does not swallow a failure on the fallback itself', async () => {
    const failing = new FakeMessageSender([MESSAGE_CHANNELS.WHATSAPP, MESSAGE_CHANNELS.SMS]);
    const { service } = otpService(whatsappFirst(), failing);

    await assert.rejects(service.request(ActorTypes.STUDENT, '9876543210'), /sms is down/);
  });

  /** An SMS-first deployment must not quietly send twice when the aggregator is down. */
  it('does not fall back when SMS was the first choice', async () => {
    const failing = new FakeMessageSender([MESSAGE_CHANNELS.SMS]);
    const { service } = otpService(new FakeConfig({ OTP_SENDER: 'sms' }), failing);

    await assert.rejects(service.request(ActorTypes.STUDENT, '9876543210'), /sms is down/);
    assert.equal(failing.sent.length, 0);
  });
});
