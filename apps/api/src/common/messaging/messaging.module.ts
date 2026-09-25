import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_SENDERS } from '../../config/env.schema';
import { ConsoleMessageSender } from './console-message-sender';
import { SmsMessageSender } from './sms-message-sender';
import { EmailMessageSender } from './email-message-sender';
import { InteraktMessageSender } from './interakt-message-sender';
import { RoutedMessageSender } from './routed-message-sender';
import { MESSAGE_CHANNELS, MESSAGE_SENDER, type MessageSender } from './message-sender';

/** Selects the outbound delivery provider. */
export function createMessageSender(
  config: AppConfigService,
  consoleSender: ConsoleMessageSender,
  smsSender: SmsMessageSender,
  emailSender: EmailMessageSender,
  whatsappSender: InteraktMessageSender,
): MessageSender {
  // The env var is still named OTP_SENDER, though it now selects for every kind and every channel.
  const mode = config.get('OTP_SENDER');

  if (mode === OTP_SENDERS.CONSOLE) {
    if (config.isProduction) {
      throw new Error('OTP_SENDER=console is not allowed in production — set OTP_SENDER=sms.');
    }
    return consoleSender;
  }

  // Required on the WhatsApp path too: SMS is the fallback nobody signs in without.
  if (!config.get('SMS_PROVIDER_URL')) {
    throw new Error(`OTP_SENDER=${mode} needs SMS_PROVIDER_URL — see .env.example.`);
  }
  // Refused here rather than at the first admin login, which is the worst time to find out.
  if (!config.get('MAIL_USER') || !config.get('MAIL_PASSWORD')) {
    throw new Error(
      `OTP_SENDER=${mode} needs MAIL_USER and MAIL_PASSWORD too — an admin signs in by email.`,
    );
  }
  if (mode === OTP_SENDERS.WHATSAPP) assertWhatsAppReady(config);

  return new RoutedMessageSender({
    [MESSAGE_CHANNELS.SMS]: smsSender,
    [MESSAGE_CHANNELS.EMAIL]: emailSender,
    // An unkeyed deployment routes the channel nowhere rather than half-way — WhatsApp is future scope.
    ...(config.get('WHATSAPP_INTERAKT_API_KEY')
      ? { [MESSAGE_CHANNELS.WHATSAPP]: whatsappSender }
      : {}),
  });
}

/** Every way a WhatsApp-first deployment could reach its first login and fail, refused at boot. */
function assertWhatsAppReady(config: AppConfigService): void {
  if (!config.get('WHATSAPP_INTERAKT_API_KEY')) {
    throw new Error('OTP_SENDER=whatsapp needs WHATSAPP_INTERAKT_API_KEY — see .env.example.');
  }
  if (!config.get('WHATSAPP_TEMPLATE_OTP')) {
    throw new Error(
      'OTP_SENDER=whatsapp needs WHATSAPP_TEMPLATE_OTP — the approved template name.',
    );
  }
}

/** Infrastructure, like `redis` and `queue` — every service that has to tell somebody something links it, and none of them become it (docs/03 §4.4). */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    ConsoleMessageSender,
    SmsMessageSender,
    EmailMessageSender,
    InteraktMessageSender,
    {
      provide: MESSAGE_SENDER,
      inject: [
        AppConfigService,
        ConsoleMessageSender,
        SmsMessageSender,
        EmailMessageSender,
        InteraktMessageSender,
      ],
      useFactory: createMessageSender,
    },
  ],
  exports: [MESSAGE_SENDER],
})
export class MessagingModule {}
