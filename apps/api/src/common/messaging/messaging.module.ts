import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_SENDERS } from '../../config/env.schema';
import { ConsoleMessageSender } from './console-message-sender';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';

/**
 * Selects the outbound delivery provider.
 *
 * The console sender is a development convenience and is refused outright in
 * production, so a misconfigured deploy fails at boot rather than quietly
 * printing live OTP codes into a log. This check used to live in AuthModule;
 * it moved with the sender, because it belongs to the sender and not to auth.
 *
 * MSG91 (SMS) and SMTP (email) implement the same interface and drop in here —
 * no caller changes. When they do, this becomes a lookup by channel rather than
 * one provider for everything; the seam is already the right shape for it.
 */
export function createMessageSender(
  config: AppConfigService,
  consoleSender: ConsoleMessageSender,
): MessageSender {
  // The env var is still named OTP_SENDER. It now selects the provider for
  // every outbound message, not just OTP — renaming it is a config change for
  // every environment, which is not worth doing in the same commit as a
  // refactor that changes no behaviour.
  // TODO(docs/03 §10): rename to MESSAGE_SENDER when providers land.
  const channel = config.get('OTP_SENDER');

  if (channel === OTP_SENDERS.CONSOLE) {
    if (config.isProduction) {
      throw new Error('OTP_SENDER=console is not allowed in production — configure MSG91.');
    }
    return consoleSender;
  }

  throw new Error(`OTP_SENDER="${channel}" is not implemented yet.`);
}

/**
 * Infrastructure, like `redis` and `queue` — every service that has to tell
 * somebody something links it, and none of them become it (docs/03 §4.4).
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    ConsoleMessageSender,
    {
      provide: MESSAGE_SENDER,
      inject: [AppConfigService, ConsoleMessageSender],
      useFactory: createMessageSender,
    },
  ],
  exports: [MESSAGE_SENDER],
})
export class MessagingModule {}
