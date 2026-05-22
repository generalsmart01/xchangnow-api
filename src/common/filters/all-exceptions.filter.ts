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

/**
 * Error envelope returned to the client. Mirrors the success envelope's shape
 * so the frontend has ONE response parser that branches only on `success`.
 *
 *   { success: false, message, error: { statusCode, code? }, meta: {...} }
 */
interface ErrorEnvelope {
  success: false;
  message: string;
  error: {
    statusCode: number;
    /** Nest's class-name code, e.g. "Conflict", "BadRequest". Optional. */
    code?: string;
    /** Validation error details (array of strings) when present. */
    details?: string[];
  };
  meta: {
    requestId: string;
    timestamp: string;
    path: string;
  };
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

    // Mint a requestId if no interceptor ran first (e.g. an exception from a
    // guard, which fires before interceptors do).
    if (!request.id) request.id = randomUUID();

    const body = this.buildBody(exception, status, request);

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

    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      // Nest exceptions can return either a string ("Forbidden") or a structured
      // object ({ message, error, statusCode }). Validation pipe returns
      // { message: string[], error: 'Bad Request', statusCode: 400 } — we keep
      // the array as `details` and surface the first item as the main message.
      if (typeof res === 'string') {
        return {
          success: false,
          message: res,
          error: { statusCode: status },
          meta,
        };
      }

      const obj = res as {
        message?: string | string[];
        error?: string;
      };

      const messages = Array.isArray(obj.message) ? obj.message : undefined;
      const primary = messages
        ? messages[0]
        : (obj.message as string | undefined) ?? exception.message;

      return {
        success: false,
        message: primary,
        error: {
          statusCode: status,
          code: obj.error,
          ...(messages ? { details: messages } : {}),
        },
        meta,
      };
    }

    // Unknown / non-HttpException — never leak internals to the client.
    return {
      success: false,
      message: 'Internal server error',
      error: { statusCode: status },
      meta,
    };
  }
}
