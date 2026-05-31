// src/modules/auth/decorators/current-user.decorator.ts

/**
 * @CurrentUser — parameter decorator that pulls the authenticated user
 * (the value JwtStrategy.validate returned) out of the request.
 *
 * Two forms:
 *   - `@CurrentUser() user: AuthenticatedUser`  — the full object
 *   - `@CurrentUser('id') userId: string`       — single field
 *
 * Returns undefined if the request isn't authenticated. In practice every
 * route using this decorator should also have JwtAuthGuard so undefined
 * never reaches the handler.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
