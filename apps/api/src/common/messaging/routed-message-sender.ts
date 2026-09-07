/**
 * A student is reached by WhatsApp or SMS and an admin by email, so the seam's
 * one implementation is several providers with a switch in front. Every caller
 * still names a channel and nothing else.
 */
import { type MessageChannel, type MessageSender, type OutboundMessage } from './message-sender';

export class RoutedMessageSender implements MessageSender {
  constructor(private readonly providers: Partial<Record<MessageChannel, MessageSender>>) {}

  async send(message: OutboundMessage): Promise<void> {
    const provider = this.providers[message.channel];
    // IN_APP is a row in `Notification`, written by the notifications module and never sent.
    if (!provider) throw new Error(`Nothing delivers ${message.channel} messages.`);

    return provider.send(message);
  }
}
