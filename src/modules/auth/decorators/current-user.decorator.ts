import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Use in controllers as `@CurrentUser() user: AuthenticatedUser`
 * or `@CurrentUser('id') userId: string` to pluck a single field.
 *
 * Requires JwtAuthGuard to have run, which populates req.user.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
