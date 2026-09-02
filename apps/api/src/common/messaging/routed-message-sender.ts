/**
 * A student is reached by SMS and an admin by email, so the seam's one
 * implementation has to be two providers with a switch in front. Every caller
 * still names a channel and nothing else.
 */
import { MESSAGE_CHANNELS, type MessageSender, type OutboundMessage } from './message-sender';

export class RoutedMessageSender implements MessageSender {
  constructor(
    private readonly sms: MessageSender,
    private readonly email: MessageSender,
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel === MESSAGE_CHANNELS.SMS) return this.sms.send(message);
    if (message.channel === MESSAGE_CHANNELS.EMAIL) return this.email.send(message);

    // IN_APP is a row in `Notification`, written by the notifications module and never sent.
    throw new Error(`Nothing delivers ${message.channel} messages.`);
  }
}
