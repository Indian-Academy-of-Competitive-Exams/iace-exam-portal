import { Injectable, Logger } from '@nestjs/common';
import { type OtpDelivery, type OtpSender } from './otp-sender';

/**
 * Development sender: prints the code to the API log instead of spending an
 * SMS. Selected by OTP_SENDER=console; AuthModule refuses to bind it when
 * NODE_ENV=production.
 */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  send({ actor, destination, code, ttlSec }: OtpDelivery): Promise<void> {
    const width = 44;
    const line = (text: string) => `  │ ${text.padEnd(width)} │`;

    this.logger.log(
      [
        '',
        `  ┌${'─'.repeat(width + 2)}┐`,
        line(`OTP for ${actor} — ${destination}`),
        line(`CODE: ${code}`),
        line(`valid for ${ttlSec}s`),
        `  └${'─'.repeat(width + 2)}┘`,
      ].join('\n'),
    );
    return Promise.resolve();
  }
}
