// src/integrations/email/email.service.ts

/**
 * EmailService — outbound transactional email.
 *
 * Sends via nodemailer when SMTP env vars are set; otherwise falls back
 * to console logging (dev-friendly — no SMTP needed to develop locally).
 *
 * Public methods:
 *   - sendVerificationEmail(to, token)   verify-email link, 24h TTL
 *   - sendPasswordResetEmail(to, token)  password-reset link, 1h TTL
 *   - sendInviteEmail(to, token, opts)   staff invite link, 24h TTL
 *
 * All links point at the FRONTEND (FRONTEND_URL env var), not the backend.
 * The frontend pages /verify-email, /reset-password, /accept-invite
 * extract the token from the URL and POST it to the backend.
 *
 * Boot-time SMTP verification: if SMTP_* are set, the constructor's
 * onModuleInit hook calls transporter.verify() and fails loudly on bad
 * credentials. Better to crash at boot than silently drop password resets
 * for a week before noticing.
 *
 * Env vars (all optional — leave unset to keep console-logging):
 *   SMTP_HOST     e.g. smtp.gmail.com, sandbox.smtp.mailtrap.io
 *   SMTP_PORT     typically 587 (STARTTLS) or 465 (SSL)
 *   SMTP_USER     auth username
 *   SMTP_PASS     auth password / app-password / API key
 *   EMAIL_FROM    the From address (must match SMTP_USER for Gmail or it
 *                 gets rewritten)
 *   FRONTEND_URL  used to build the user-facing links inside emails
 *
 * Drop-in providers tested: Mailtrap (dev/staging), Gmail SMTP. Production
 * options: Resend, Mailgun, Postmark, SendGrid.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';


@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress = 'XchangNow <no-reply@xchangnow.com>';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const from = this.config.get<string>('EMAIL_FROM');

    if (from) this.fromAddress = from;

    if (!host || !port || !user || !pass) {
      this.logger.warn(
        'SMTP_* env vars not fully configured — emails will be logged, not sent. ' +
          'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to enable real delivery.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS (false here, upgraded after CONNECT)
      auth: { user, pass },
    });

    // Verify credentials at boot — fail loudly if SMTP is misconfigured rather
    // than silently dropping mail until a user tries to register.
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP transport ready: ${host}:${port}`);
    } catch (err) {
      this.logger.error(
        `SMTP verify failed (${host}:${port}): ${(err as Error).message}. ` +
          'Falling back to console logging.',
      );
      this.transporter = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    // Link points at the FRONTEND page, not the backend API. The frontend
    // page extracts the token from the query string and POSTs it to
    // /api/auth/verify-email on this server. That way the user lands on a
    // branded confirmation screen, not a JSON response.
    //
    // FRONTEND_URL is a comma-separated list; the FIRST entry is the canonical
    // user-facing frontend (the admin dashboard never receives onboarding emails).
    const base = this.userFrontendUrl();
    const verifyUrl = `${base}/verify-email?token=${rawToken}`;

    await this.send({
      to,
      subject: 'Verify your XchangNow email',
      text: [
        'Welcome to XchangNow.',
        '',
        'Click the link below to verify your email address:',
        verifyUrl,
        '',
        "This link expires in 24 hours. If you didn't sign up, ignore this email.",
      ].join('\n'),
      html: this.htmlTemplate({
        title: 'Verify your email',
        intro: 'Welcome to XchangNow! Confirm your email to activate your account.',
        cta: { label: 'Verify Email', url: verifyUrl, color: '#0F62FE' },
        footer: "Link expires in 24 hours. If you didn't sign up, you can ignore this.",
      }),
    });
  }

  async sendInviteEmail(
    to: string,
    rawToken: string,
    opts: { inviterName: string; role: string },
  ): Promise<void> {
    // Link points at the frontend's /accept-invite page. Page reads
    // ?token=... and posts to POST /api/auth/accept-invite with the token
    // plus the password the invitee picks.
    const base = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const acceptUrl = `${base}/accept-invite?token=${rawToken}`;

    await this.send({
      to,
      subject: `You've been invited to XchangNow as ${opts.role}`,
      text: [
        `${opts.inviterName} has invited you to join the XchangNow team`,
        `as a ${opts.role}.`,
        '',
        'Click the link below to set your password and activate your account:',
        acceptUrl,
        '',
        "This invite expires in 24 hours. If you weren't expecting this email,",
        'you can safely ignore it.',
      ].join('\n'),
      html: this.htmlTemplate({
        title: 'Welcome to XchangNow',
        intro:
          `${opts.inviterName} has invited you to join the XchangNow team as a ` +
          `<strong>${opts.role}</strong>. Click below to set your password and ` +
          'activate your account.',
        cta: { label: 'Accept Invite', url: acceptUrl, color: '#0F62FE' },
        footer:
          "Invite expires in 24 hours. If you weren't expecting this, you can ignore it.",
      }),
    });
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    // Same as the verification link: frontend page handles the UX and proxies
    // the token to /api/auth/reset-password on the backend.
    const base = this.userFrontendUrl();
    const resetUrl = `${base}/reset-password?token=${rawToken}`;

    await this.send({
      to,
      subject: 'Reset your XchangNow password',
      text: [
        'A password reset was requested for your account.',
        '',
        'Reset link:',
        resetUrl,
        '',
        "This link expires in 1 hour. If you didn't request this, ignore the email.",
      ].join('\n'),
      html: this.htmlTemplate({
        title: 'Reset your password',
        intro:
          'A password reset was requested for your XchangNow account. ' +
          'Click below to set a new password.',
        cta: { label: 'Reset Password', url: resetUrl, color: '#DA1E28' },
        footer:
          "Link expires in 1 hour. If you didn't request a reset, ignore this — your account is safe.",
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Sends a single message. If no transporter is configured (dev mode or boot
   * verify failed) the message is logged to stdout instead — useful for tests
   * that need to scrape verification tokens.
   *
   * Email failures NEVER throw — auth/transaction flows shouldn't break if
   * the SMTP provider is briefly unreachable. We log the error and continue.
   */
  private async send(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        '\n=== DEV EMAIL ===\n' +
          `To:      ${message.to}\n` +
          `Subject: ${message.subject}\n` +
          '--------------------------------------\n' +
          `${message.text}\n` +
          '==================',
      );
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logger.log(
        `Email sent to ${message.to}: messageId=${info.messageId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${message.to}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Returns the canonical USER-facing frontend URL, stripped of any trailing
   * slash. FRONTEND_URL is a comma-separated list whose first entry is, by
   * convention, the user app (the management dashboard is in subsequent
   * entries and never receives transactional emails).
   */
  private userFrontendUrl(): string {
    const raw = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3001',
    );
    const first = raw.split(',')[0].trim();
    return first.replace(/\/$/, '');
  }

  /**
   * Minimal inline-styled HTML template. Inline styles because email clients
   * strip <style> tags; tested patterns (table-based layouts) would be overkill
   * for this volume of email. Keep it simple.
   */
  private htmlTemplate(opts: {
    title: string;
    intro: string;
    cta: { label: string; url: string; color: string };
    footer: string;
  }): string {
    return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f6f6;margin:0;padding:24px;">
    <table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;">
      <tr>
        <td style="padding:32px;">
          <h1 style="color:#111;font-size:22px;margin:0 0 12px 0;">${opts.title}</h1>
          <p style="color:#444;font-size:15px;line-height:1.5;margin:0 0 24px 0;">${opts.intro}</p>
          <p style="margin:0 0 24px 0;">
            <a href="${opts.cta.url}"
               style="display:inline-block;background:${opts.cta.color};color:#fff;
                      text-decoration:none;padding:12px 22px;border-radius:6px;
                      font-weight:600;font-size:15px;">
              ${opts.cta.label}
            </a>
          </p>
          <p style="color:#666;font-size:13px;margin:0 0 8px 0;">Or paste this link in your browser:</p>
          <p style="word-break:break-all;font-size:13px;margin:0 0 24px 0;">
            <a href="${opts.cta.url}" style="color:#0F62FE;">${opts.cta.url}</a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="color:#888;font-size:12px;line-height:1.5;margin:0;">${opts.footer}</p>
        </td>
      </tr>
    </table>
    <p style="color:#aaa;font-size:11px;text-align:center;margin-top:16px;">
      &copy; XchangNow &middot; Lagos, Nigeria
    </p>
  </body>
</html>`;
  }
}
