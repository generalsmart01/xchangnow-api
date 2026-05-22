import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { map, Observable } from 'rxjs';
import { LOG_MESSAGE_KEY } from '../decorators/log-message.decorator';
import { RequestWithId } from './http-logging.interceptor';

/**
 * Standard success envelope. Every successful HTTP response is wrapped in this
 * shape so the frontend has ONE response parser instead of N.
 *
 * - `success` — quick boolean for the happy path
 * - `message` — pulled from the @LogMessage decorator on the handler
 * - `data`   — whatever the controller returned (paginated lists, single
 *              records, etc. — the controller layer's shape is preserved)
 * - `meta`   — requestId (for support), timestamps, latency, the original path
 *
 * Errors are wrapped in a similar shape by AllExceptionsFilter — see there.
 */
export interface ResponseEnvelope<T = unknown> {
  success: true;
  message: string;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    durationMs: number;
    path: string;
  };
}

@Injectable()
export class ResponseInterceptor<T = unknown>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseEnvelope<T>> {
    // Only wrap HTTP responses — leave RPC/WebSocket alone.
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ResponseEnvelope<T>>;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithId>();

    // HttpLoggingInterceptor sets req.id earlier in the chain — but if this
    // interceptor ever runs first (e.g. someone reorders main.ts), generate
    // one here so the contract still holds.
    if (!req.id) req.id = randomUUID();

    const message =
      this.reflector.get<string>(LOG_MESSAGE_KEY, context.getHandler()) ??
      'Success';

    const startedAt = Date.now();

    // Express drops the response body on 204, so even if we wrap a void return
    // into this envelope, the client just sees an empty body — no special case.
    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        message,
        data,
        meta: {
          requestId: req.id!,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          path: req.originalUrl,
        },
      })),
    );
  }
}
