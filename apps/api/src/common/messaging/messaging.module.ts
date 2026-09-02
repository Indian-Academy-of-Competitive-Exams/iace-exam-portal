import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_SENDERS } from '../../config/env.schema';
import { ConsoleMessageSender } from './console-message-sender';
import { SmsMessageSender } from './sms-message-sender';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';

/** Selects the outbound delivery provider. */
export function createMessageSender(
  config: AppConfigService,
  consoleSender: ConsoleMessageSender,
  smsSender: SmsMessageSender,
): MessageSender {
  // The env var is still named OTP_SENDER, though it now selects for every kind.
  const channel = config.get('OTP_SENDER');

  if (channel === OTP_SENDERS.CONSOLE) {
    if (config.isProduction) {
      throw new Error('OTP_SENDER=console is not allowed in production — set OTP_SENDER=sms.');
    }
    return consoleSender;
  }

  if (!config.get('SMS_PROVIDER_URL')) {
    throw new Error('OTP_SENDER=sms needs SMS_PROVIDER_URL — see .env.example.');
  }
  return smsSender;
}

/**
 * Infrastructure, like `redis` and `queue` — every service that has to tell somebody something
 * links it, and none of them become it (docs/03 §4.4).
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    ConsoleMessageSender,
    SmsMessageSender,
    {
      provide: MESSAGE_SENDER,
      inject: [AppConfigService, ConsoleMessageSender, SmsMessageSender],
      useFactory: createMessageSender,
    },
  ],
  exports: [MESSAGE_SENDER],
})
export class MessagingModule {}
