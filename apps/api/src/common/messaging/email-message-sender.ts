/**
 * Email, which is how an admin signs in. Placeholder in the same sense the SMS
 * sender is: SMTP is the protocol every provider speaks, so host, port,
 * credentials and the from-address are env and choosing one changes no code.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { MESSAGE_CHANNELS, type MessageSender, type OutboundMessage } from './message-sender';

/** The implicit-TLS port. Everything else negotiates STARTTLS, which nodemailer does on its own. */
const IMPLICIT_TLS_PORT = 465;

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
      from: this.config.get('SMTP_FROM'),
      to: message.to,
      subject: message.subject ?? 'IACE',
      text: message.body,
    });
  }

  /** Built once and kept: a pool outlives one message, and an OTP should not pay for a handshake. */
  private connection(): Transporter {
    if (this.transport) return this.transport;

    const host = this.config.get('SMTP_HOST');
    if (!host) throw new Error('SMTP_HOST is not set.');

    const port = this.config.get('SMTP_PORT');
    const user = this.config.get('SMTP_USER');
    const pass = this.config.get('SMTP_PASSWORD');

    this.transport = createTransport({
      host,
      port,
      secure: port === IMPLICIT_TLS_PORT,
      pool: true,
      // An unauthenticated relay is a real deployment — an internal one, or a sidecar.
      ...(user ? { auth: { user, pass } } : {}),
    });
    this.logger.log(`Email ready: ${host}:${port}`);

    return this.transport;
  }
}
