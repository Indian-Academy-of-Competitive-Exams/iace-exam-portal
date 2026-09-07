/**
 * WhatsApp through Interakt, which resells the same Cloud API behind its own
 * field names. Kept beside the direct sender rather than replacing it: which
 * one is in front is a config value, so leaving is a restart, not a rewrite.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { MESSAGE_CHANNELS, type MessageSender, type OutboundMessage } from './message-sender';
import {
  INDIA_DIALLING_CODE,
  nationalMobile,
  whatsappTemplateFor,
  type WhatsAppTemplate,
} from './whatsapp-template';

const SEND_TIMEOUT_MS = 4000;

interface InteraktResponse {
  result?: boolean;
  message?: string;
  id?: string;
}

@Injectable()
export class InteraktMessageSender implements MessageSender {
  private readonly logger = new Logger('Outbound');

  constructor(private readonly config: AppConfigService) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== MESSAGE_CHANNELS.WHATSAPP) {
      throw new Error(`The WhatsApp sender was handed a ${message.channel} message.`);
    }

    const template = whatsappTemplateFor(this.config, message.kind, message.data);
    if (!template) {
      this.logger.warn(`Not sending "${message.kind}": no WhatsApp template is configured for it.`);
      return;
    }

    await this.post({
      countryCode: `+${INDIA_DIALLING_CODE}`,
      phoneNumber: nationalMobile(message.to),
      type: 'Template',
      template: templateFor(template),
    });
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.config.get('WHATSAPP_INTERAKT_URL'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${this.config.get('WHATSAPP_INTERAKT_API_KEY') ?? ''}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Interakt answered ${response.status}`);
    }

    // Interakt reports a refusal INSIDE a 200, so the status alone would read a rejection as sent.
    const payload = (await response.json()) as InteraktResponse;
    if (payload.result !== true) {
      throw new Error(`Interakt refused the message: ${payload.message ?? 'no reason given'}`);
    }
  }
}

function templateFor(template: WhatsAppTemplate): Record<string, unknown> {
  return {
    name: template.name,
    languageCode: template.language,
    bodyValues: template.values,
    ...(template.hasOtpButton ? { buttonValues: { '0': template.values.slice(0, 1) } } : {}),
  };
}
