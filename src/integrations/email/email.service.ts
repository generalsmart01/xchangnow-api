import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * EmailService — provider-agnostic abstraction.
 *
 * Current implementation logs to console (dev). Production should swap the
 * private send() impl for nodemailer + Resend / SES / Mailgun / etc.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const base = this.config.get<string>('APP_URL', 'http://localhost:3450');
    const verifyUrl = `${base}/api/auth/verify-email?token=${rawToken}`;

    await this.send({
      to,
      subject: 'Verify your XchangeNow email',
      body: [
        `Welcome to XchangeNow.`,
        ``,
        `Click the link below to verify your email address:`,
        verifyUrl,
        ``,
        `This link expires in 24 hours. If you didn't sign up, ignore this email.`,
      ].join('\n'),
    });
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const base = this.config.get<string>('APP_URL', 'http://localhost:3450');
    const resetUrl = `${base}/api/auth/reset-password?token=${rawToken}`;

    await this.send({
      to,
      subject: 'Reset your XchangeNow password',
      body: [
        `A password reset was requested for your account.`,
        ``,
        `Reset link:`,
        resetUrl,
        ``,
        `This link expires in 1 hour. If you didn't request this, ignore the email.`,
      ].join('\n'),
    });
  }

  private async send(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    // TODO: swap for nodemailer + real provider (Resend / SES / Mailgun) in prod.
    // For now, logging is the "transport" — keep the format aggressively visible
    // because dev tests scrape this output to find verification tokens.
    this.logger.log(
      `\n=== DEV EMAIL ===\n` +
        `To:      ${message.to}\n` +
        `Subject: ${message.subject}\n` +
        `--------------------------------------\n` +
        `${message.body}\n` +
        `==================`,
    );
  }
}
