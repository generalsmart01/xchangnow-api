import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../database/prisma.service';
import { REQUIRE_VERIFIED_KEY } from '../decorators/require-verified.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Blocks the route if the authenticated user's email isn't verified.
 *
 * Only enforces when @RequireVerified() is present on the handler or class —
 * otherwise it's a no-op. Pair with JwtAuthGuard upstream so request.user is set.
 *
 * Uses a fresh DB lookup rather than reading from the JWT, so a user who
 * verifies *after* their token was issued doesn't have to re-login.
 */
@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_VERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true; // route doesn't require verification

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // Should not happen — JwtAuthGuard rejects unauthenticated requests first.
      throw new ForbiddenException('Authentication required');
    }

    const fresh = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isEmailVerified: true },
    });

    if (!fresh?.isEmailVerified) {
      throw new ForbiddenException(
        'Please verify your email address before performing this action',
      );
    }

    return true;
  }
}
