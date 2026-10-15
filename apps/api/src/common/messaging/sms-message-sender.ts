/**
 * The SMS gateway (Spearuc). Under India's DLT rules every message is a registered template, and
 * this gateway wants its full text, character for character, beside the template id — so the text
 * lives here, the id in env, and a kind with either missing is off. The credentials ride the query
 * string, so the URL is never logged.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  MESSAGE_KINDS,
  MessageNotConfiguredError,
  REQUIRED_KINDS,
  type MessageKind,
  type MessageSender,
  type OutboundMessage,
} from './message-sender';

/** Which env var carries each kind's registered template id. */
const TEMPLATE_KEYS = {
  [MESSAGE_KINDS.OTP]: 'SMS_TEMPLATE_OTP',
  [MESSAGE_KINDS.RESULT_READY]: 'SMS_TEMPLATE_RESULT_READY',
  [MESSAGE_KINDS.TEST_ASSIGNED]: 'SMS_TEMPLATE_TEST_ASSIGNED',
  [MESSAGE_KINDS.TEST_REMINDER]: 'SMS_TEMPLATE_TEST_REMINDER',
  [MESSAGE_KINDS.ANNOUNCEMENT]: 'SMS_TEMPLATE_ANNOUNCEMENT',
} as const satisfies Record<MessageKind, string>;

const DLT_VAR = '{#var#}';

/** The registered wording, exactly; each `{#var#}` takes the next field of `data`, in order. */
const DLT_TEXTS: Partial<Record<MessageKind, { text: string; fields: readonly string[] }>> = {
  [MESSAGE_KINDS.OTP]: {
    text: 'Your OTP for IACE Login is {#var#}. This OTP is valid for 5 minutes. Do not share this OTP with anyone. Indian Academy of Competitive Exams.',
    fields: ['code'],
  },
};

const GATEWAY_REFUSAL = /^\s*ERROR/i;

/** The gateway's own advice: a slow answer may still have sent, so wait it out rather than retry. */
const SEND_TIMEOUT_MS = 15_000;

@Injectable()
export class SmsMessageSender implements MessageSender {
  private readonly logger = new Logger('Outbound');

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundMessage): Promise<void> {
    const templateId = this.config.get(TEMPLATE_KEYS[message.kind]);
    const registered = DLT_TEXTS[message.kind];
    if (!templateId || !registered) {
      if (REQUIRED_KINDS.has(message.kind)) {
        throw new Error(`No DLT template is configured for "${message.kind}".`);
      }
      // Off, not broken — but the caller is told, or it would record this as delivered.
      this.logger.warn(`Not sending "${message.kind}": no DLT template is configured for it.`);
      throw new MessageNotConfiguredError(message.kind);
    }

    const answer = await this.get({
      type: 'smsquicksend',
      user: this.config.get('SMS_PROVIDER_USER') ?? '',
      pass: this.config.get('SMS_PROVIDER_PASS') ?? '',
      sender: this.config.get('SMS_SENDER_ID'),
      to_mobileno: message.to,
      sms_text: fill(registered.text, registered.fields, message.data ?? {}),
      t_id: templateId,
    });
    this.logger.log(`SMS "${message.kind}" to ******${message.to.slice(-4)}: ${answer}`);
  }

  private async get(params: Record<string, string>): Promise<string> {
    const base = this.config.get('SMS_PROVIDER_URL');
    if (!base) throw new Error('SMS_PROVIDER_URL is not set.');
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    const answer = (await response.text()).trim();
    if (!response.ok) throw new Error(`SMS gateway answered ${response.status}: ${answer}`);
    if (GATEWAY_REFUSAL.test(answer)) throw new Error(`SMS gateway refused: ${answer}`);
    return answer;
  }
}

function fill(text: string, fields: readonly string[], data: Record<string, string | number>) {
  let next = 0;
  return text.replaceAll(DLT_VAR, () => String(data[fields[next++] ?? ''] ?? ''));
}
