import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { LOG_MESSAGE_KEY } from '../decorators/log-message.decorator';

/**
 * Express request gets an `id` field at the start of every request. Both the
 * HTTP logger and the ResponseInterceptor read it, so the requestId in the
 * terminal log line matches the one returned to the client in `meta.requestId`.
 * That correlation is what makes support workflows work: a user reports a
 * problem with requestId X, you grep the terminal for X and see the whole flow.
 */
export type RequestWithId = Request & { id?: string; user?: { id?: string } };

/**
 * Fields stripped from logged request bodies. We never want secrets or tokens
 * showing up in stdout — they'd land in CloudWatch / Render logs forever.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authorization',
]);

/**
 * Global HTTP logger. Emits one INFO line per successful response and one WARN
 * (4xx) or ERROR (5xx) line per failed response. AllExceptionsFilter still owns
 * the 5xx stack trace — this interceptor stays focused on the one-line summary.
 *
 * The shape is intentionally grep-friendly:
 *   [HTTP] METHOD path STATUS  Xms  user=USERID  — message  body={...}
 *
 * Auth header and password-like fields are redacted before printing.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP contexts — skip if this ever runs over RPC/WS.
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();

    // Mint a requestId once per request and stash it on the request object so
    // every downstream consumer (ResponseInterceptor, exception filter) reads
    // the same value. randomUUID is in core crypto since Node 14.17 — no dep.
    if (!req.id) req.id = randomUUID();
    const requestId = req.id;

    const message =
      this.reflector.get<string>(LOG_MESSAGE_KEY, context.getHandler()) ??
      undefined;

    const startedAt = Date.now();
    const { method, originalUrl } = req;
    const userId = req.user?.id ?? '-';

    // Pre-call log — useful when an endpoint hangs and you want to see what
    // started but never finished. Body only logged if non-empty.
    const reqBody = this.redact(req.body);
    const bodyPreview =
      reqBody && Object.keys(reqBody).length > 0
        ? ` body=${this.safeStringify(reqBody)}`
        : '';
    this.logger.log(
      `→ ${method} ${originalUrl} req=${requestId} user=${userId}${bodyPreview}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - startedAt;
          const status = res.statusCode;
          const label = message ?? (status < 400 ? 'OK' : 'ERROR');
          this.logger.log(
            `← ${method} ${originalUrl} ${status} ${ms}ms req=${requestId} — ${label}`,
          );
        },
        error: (err: unknown) => {
          // The exception filter will set the final status; at this moment res.statusCode
          // is still 200, so derive from the thrown HttpException if present.
          const ms = Date.now() - startedAt;
          const status =
            (err as { status?: number; getStatus?: () => number })?.getStatus?.() ??
            (err as { status?: number }).status ??
            500;
          const errMessage =
            (err as { message?: string }).message ?? 'Unhandled error';
          const label = message ? `${message} (failed)` : 'ERROR';
          const fn = status >= 500 ? 'error' : 'warn';
          this.logger[fn](
            `← ${method} ${originalUrl} ${status} ${ms}ms req=${requestId} — ${label}: ${errMessage}`,
          );
        },
      }),
    );
  }

  /**
   * Recursively redact sensitive keys. Returns a copy so we don't mutate the
   * original request body — that would corrupt downstream consumers.
   */
  private redact(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    if (typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = this.redact(v);
      }
    }
    return out;
  }

  /** JSON.stringify that won't blow up on circular structures (defensive). */
  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }
}
