/**
 * The SMS provider, as a shape rather than a name. India's DLT rules mean every
 * message is a registered template id and a set of variables, and that is true
 * of every aggregator — so endpoint, key, sender id and the template per kind
 * all come from env, and swapping provider is a config change, not a code one.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MessageNotConfiguredError,
  REQUIRED_KINDS,
  type MessageKind,
  type MessageSender,
  type OutboundMessage,
} from './message-sender';

/** Which env var carries each kind's registered template. Adding a kind is adding a line to both. */
const TEMPLATE_KEYS = {
  [MESSAGE_KINDS.OTP]: 'SMS_TEMPLATE_OTP',
  [MESSAGE_KINDS.PIN]: 'SMS_TEMPLATE_PIN',
  [MESSAGE_KINDS.RESULT_READY]: 'SMS_TEMPLATE_RESULT_READY',
  [MESSAGE_KINDS.TEST_ASSIGNED]: 'SMS_TEMPLATE_TEST_ASSIGNED',
  [MESSAGE_KINDS.TEST_REMINDER]: 'SMS_TEMPLATE_TEST_REMINDER',
  [MESSAGE_KINDS.ANNOUNCEMENT]: 'SMS_TEMPLATE_ANNOUNCEMENT',
} as const satisfies Record<MessageKind, string>;

/** Long enough for a slow aggregator, short enough that a student is not left watching a spinner. */
const SEND_TIMEOUT_MS = 8000;

@Injectable()
export class SmsMessageSender implements MessageSender {
  private readonly logger = new Logger('Outbound');

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== MESSAGE_CHANNELS.SMS) {
      throw new Error(
        `No provider is configured for ${message.channel}. Set MAIL_* and wire an email sender.`,
      );
    }

    const templateId = this.templateFor(message.kind);
    if (!templateId) {
      if (REQUIRED_KINDS.has(message.kind)) {
        throw new Error(`No DLT template is configured for "${message.kind}".`);
      }
      // Off, not broken — but the caller is told, or it would record this as delivered.
      this.logger.warn(`Not sending "${message.kind}": no DLT template is configured for it.`);
      throw new MessageNotConfiguredError(message.kind);
    }

    await this.post({
      to: message.to,
      templateId,
      senderId: this.config.get('SMS_SENDER_ID'),
      variables: message.data ?? {},
    });
  }

  /** Placeholder shape, one POST — the concrete provider's field names land here and nowhere else. */
  private async post(payload: Record<string, unknown>): Promise<void> {
    const url = this.config.get('SMS_PROVIDER_URL');
    if (!url) throw new Error('SMS_PROVIDER_URL is not set.');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: this.config.get('SMS_PROVIDER_KEY') ?? '',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`SMS provider answered ${response.status}`);
    }
  }

  private templateFor(kind: MessageKind): string | undefined {
    return this.config.get(TEMPLATE_KEYS[kind]);
  }
}
