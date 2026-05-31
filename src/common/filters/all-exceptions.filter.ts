// src/common/filters/all-exceptions.filter.ts

/**
 * Global exception → JSON converter. Every uncaught exception in the app
 * passes through here and is shaped into the canonical error envelope.
 *
 * Envelope shape (mirrors the success envelope's structure so the FE has
 * ONE response parser branching only on `success`):
 *
 *   {
 *     "success": false,
 *     "message": "Phone number already registered",
 *     "data": null,
 *     "error": {
 *       "code": "CONFLICT",
 *       "details": ["Phone number already registered"]
 *     },
 *     "meta": {
 *       "requestId": "...",
 *       "timestamp": "...",
 *       "path": "..."
 *     }
 *   }
 *
 * Design choices:
 *   - `error.code` is a SEMANTIC uppercase string ("VALIDATION_ERROR",
 *     "CONFLICT", "NOT_FOUND") — NOT Nest's exception class name. Frontend
 *     can switch on these without knowing the framework.
 *   - `error.statusCode` is intentionally OMITTED. The HTTP status line is
 *     the source of truth; duplicating it inside the body invites drift.
 *   - `details` is ALWAYS an array (possibly empty). No `undefined`s for
 *     the frontend to defensively check.
 *   - `data: null` for shape symmetry with success responses.
 *   - `meta.requestId` is read from `req.id` (minted by
 *     HttpLoggingInterceptor earlier in the request). DO NOT regenerate
 *     here — the value in the terminal log line must match the one returned
 *     to the client so a user reporting an issue can hand you their
 *     requestId and you grep logs.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { RequestWithId } from '../interceptors/http-logging.interceptor';

interface ErrorEnvelope {
  success: false;
  message: string;
  data: null;
  error: {
    code: string;
    details: string[];
  };
  meta: {
    requestId: string;
    timestamp: string;
    path: string;
  };
}

/**
 * Maps an HTTP status code to a semantic error code that's friendlier for the
 * frontend than Nest's class-name codes. Falls through to INTERNAL_SERVER_ERROR
 * for anything unknown.
 */
function errorCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Mint a requestId if no interceptor ran first (e.g. an exception thrown
    // from a guard, which fires BEFORE interceptors). The HttpLoggingInterceptor
    // is the normal source.
    if (!request.id) request.id = randomUUID();

    const body = this.buildBody(exception, status, request);

    // 5xx logs include the full stack — operators need it for diagnosis.
    // 4xx are "expected" errors (validation, auth, conflicts) and don't
    // deserve stack traces in the terminal — the interceptor's one-line
    // WARN already records them.
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} req=${request.id}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private buildBody(
    exception: unknown,
    status: number,
    request: RequestWithId,
  ): ErrorEnvelope {
    const meta = {
      requestId: request.id!,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    // Internal helper to build the final envelope — keeps the shape consistent
    // across all the branches below.
    const envelope = (message: string, details: string[]): ErrorEnvelope => ({
      success: false,
      message,
      data: null,
      error: {
        code: errorCodeFromStatus(status),
        details,
      },
      meta,
    });

    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      // Nest exceptions return either a string ("Forbidden resource") or a
      // structured object. The validation pipe returns
      //   { message: string[], error: 'Bad Request', statusCode: 400 }
      // — we treat the array as `details` and surface the first item as the
      // human-readable `message`.
      if (typeof res === 'string') {
        return envelope(res, [res]);
      }

      const obj = res as {
        message?: string | string[];
        error?: string;
      };

      if (Array.isArray(obj.message)) {
        const messages = obj.message;
        const primary = messages[0] ?? exception.message;
        return envelope(primary, messages);
      }

      const single =
        (typeof obj.message === 'string' ? obj.message : undefined) ??
        exception.message;
      return envelope(single, [single]);
    }

    // Unknown / non-HttpException — never leak internals to the client. The
    // real error + stack lives in the server log (above), associated with
    // the requestId. Support can correlate via that.
    return envelope('Internal server error', []);
  }
}
