import { Injectable, Logger } from '@nestjs/common';
import { type MessageSender, type OutboundMessage } from './message-sender';

/** Wide enough for a sentence, narrow enough to read in a crowded log. */
const MAX_WIDTH = 72;

/**
 * Breaks on spaces, so a wrapped line never splits a code in half.
 *
 * A single word wider than the box — a long email address, a URL — is sliced
 * rather than left to run through the border, because "mostly fits" is how the
 * box ends up broken again for the one message nobody tested with.
 */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';

  const flush = () => {
    if (current !== '') lines.push(current);
    current = '';
  };

  for (const word of text.split(' ')) {
    if (word.length > width) {
      flush();
      for (let at = 0; at < word.length; at += width) lines.push(word.slice(at, at + width));
    } else if (current === '') {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      flush();
      current = word;
    }
  }

  flush();
  return lines;
}

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
    // EVERY row is wrapped, not just the body: an address is as capable of
    // being too long as a sentence is.
    const rows = [
      `${message.kind} → ${message.actor} via ${message.channel}`,
      message.to,
      ...(message.subject ? [message.subject] : []),
      message.body,
    ].flatMap((row) => wrap(row, MAX_WIDTH));

    // Sized to the widest row rather than to a fixed number. A message longer
    // than the box used to run straight through its own border, which is a
    // small thing until it is the OTP you are trying to read off a busy log.
    const width = Math.max(...rows.map((row) => row.length));

    this.logger.log(
      [
        '',
        `  ┌${'─'.repeat(width + 2)}┐`,
        ...rows.map((row) => `  │ ${row.padEnd(width)} │`),
        `  └${'─'.repeat(width + 2)}┘`,
      ].join('\n'),
    );
    return Promise.resolve();
  }
}
