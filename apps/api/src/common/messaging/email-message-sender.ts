/**
 * Email, which is how an admin signs in. Gmail through nodemailer's well-known
 * service preset: host, port and TLS come from the preset, so the account and
 * its app password are the whole configuration.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { MESSAGE_CHANNELS, type MessageSender, type OutboundMessage } from './message-sender';

@Injectable()
export class EmailMessageSender implements MessageSender, OnModuleDestroy {
  private readonly logger = new Logger('Outbound');
  private transport: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleDestroy(): void {
    this.transport?.close();
    this.transport = null;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (message.channel !== MESSAGE_CHANNELS.EMAIL) {
      throw new Error(`The email sender was handed a ${message.channel} message.`);
    }

    await this.connection().sendMail({
      // Gmail rewrites the from-address to the account that authenticated, so there is nothing else to set.
      from: this.config.get('MAIL_USER'),
      to: message.to,
      subject: message.subject ?? 'IACE',
      text: message.body,
    });
  }

  /** Built once and kept: a pool outlives one message, and an OTP should not pay for a handshake. */
  private connection(): Transporter {
    if (this.transport) return this.transport;

    const user = this.config.get('MAIL_USER');
    if (!user) throw new Error('MAIL_USER is not set.');

    const pass = this.config.get('MAIL_PASSWORD');
    if (!pass) throw new Error('MAIL_PASSWORD is not set.');

    // `secure` is what the Gmail preset already sets; naming it keeps the TLS guarantee visible.
    this.transport = createTransport({
      service: 'gmail',
      secure: true,
      pool: true,
      auth: { user, pass },
    });
    this.logger.log(`Email ready: ${user}`);

    return this.transport;
  }
}
