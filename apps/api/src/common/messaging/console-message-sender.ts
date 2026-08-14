import { Injectable, Logger } from '@nestjs/common';
import { type MessageSender, type OutboundMessage } from './message-sender';

/**
 * Development sender: prints the message to the API log instead of spending an
 * SMS. Selected by OTP_SENDER=console; MessagingModule refuses to bind it when
 * NODE_ENV=production, so a misconfigured deploy fails at boot rather than
 * silently logging live OTP codes where anyone with log access can read them.
 */
@Injectable()
export class ConsoleMessageSender implements MessageSender {
  private readonly logger = new Logger('Outbound');

  send(message: OutboundMessage): Promise<void> {
    const width = 44;
    const line = (text: string) => `  │ ${text.padEnd(width)} │`;

    this.logger.log(
      [
        '',
        `  ┌${'─'.repeat(width + 2)}┐`,
        line(`${message.kind} → ${message.actor} via ${message.channel}`),
        line(message.to),
        ...(message.subject ? [line(message.subject)] : []),
        line(message.body),
        `  └${'─'.repeat(width + 2)}┘`,
      ].join('\n'),
    );
    return Promise.resolve();
  }
}
