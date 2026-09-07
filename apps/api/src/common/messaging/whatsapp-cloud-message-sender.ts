/**
 * WhatsApp through Meta's Cloud API with no reseller in between: one POST to
 * the business number's messages edge, authorised by a system-user token.
 * Meta bills on DELIVERY, so a send that fails here has cost nothing.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  MESSAGE_CHANNELS,
  MessageNotConfiguredError,
  type MessageSender,
  type OutboundMessage,
} from './message-sender';
import {
  INDIA_DIALLING_CODE,
  nationalMobile,
  whatsappTemplateFor,
  type WhatsAppTemplate,
} from './whatsapp-template';

const GRAPH_URL = 'https://graph.facebook.com';

/** Short because a fallback exists: waiting longer costs a student more than a second message does. */
const SEND_TIMEOUT_MS = 4000;

@Injectable()
export class WhatsAppCloudMessageSender implements MessageSender {
  private readonly logger = new Logger('Outbound');

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== MESSAGE_CHANNELS.WHATSAPP) {
      throw new Error(`The WhatsApp sender was handed a ${message.channel} message.`);
    }

    const template = whatsappTemplateFor(this.config, message.kind, message.data);
    if (!template) {
      // Off, not broken — but the caller is told, or it would record this as delivered.
      this.logger.warn(`Not sending "${message.kind}": no WhatsApp template is configured for it.`);
      throw new MessageNotConfiguredError(message.kind);
    }

    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: `${INDIA_DIALLING_CODE}${nationalMobile(message.to)}`,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: componentsFor(template),
      },
    });
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    const phoneNumberId = this.config.get('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
    if (!phoneNumberId) throw new Error('WHATSAPP_CLOUD_PHONE_NUMBER_ID is not set.');

    const version = this.config.get('WHATSAPP_CLOUD_API_VERSION');
    const response = await fetch(`${GRAPH_URL}/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.get('WHATSAPP_CLOUD_ACCESS_TOKEN') ?? ''}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp Cloud answered ${response.status}`);
    }
  }
}

/** An authentication template is rejected without the code in its button as well as its body. */
function componentsFor(template: WhatsAppTemplate): Record<string, unknown>[] {
  const parameters = template.values.map((text) => ({ type: 'text', text }));
  const components: Record<string, unknown>[] = [{ type: 'body', parameters }];

  if (template.hasOtpButton) {
    components.push({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: parameters.slice(0, 1),
    });
  }

  return components;
}
