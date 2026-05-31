// src/common/decorators/log-message.decorator.ts

/**
 * @LogMessage('...') — attach a human-readable label to a route. Read by
 * HttpLoggingInterceptor and printed on the per-request log line. Used to
 * make terminal logs read like a story (`User registered`, `Login failed`)
 * instead of just method names.
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Key the HttpLoggingInterceptor reads to find the per-endpoint message.
 * Exported so the interceptor can use the same constant — keeps decorator and
 * reader in lockstep.
 */
export const LOG_MESSAGE_KEY = 'logMessage';

/**
 * Attach a human-readable message to an endpoint. The HttpLoggingInterceptor
 * prints it on the per-request log line so the terminal reads like a story:
 *
 *   [HTTP] POST /api/auth/register 201 142ms — User registered
 *   [HTTP] POST /api/auth/login    200  88ms — User logged in
 *   [HTTP] POST /api/auth/login    401  91ms — Login failed
 *
 * Usage:
 *   @Post('register')
 *   @LogMessage('User registered')
 *   register(...) { ... }
 *
 * Endpoints without the decorator fall back to a generic "OK" / "ERROR" label
 * based on status code.
 */
export const LogMessage = (message: string) =>
  SetMetadata(LOG_MESSAGE_KEY, message);
