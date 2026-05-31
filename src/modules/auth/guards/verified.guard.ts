// src/modules/auth/guards/verified.guard.ts

/**
 * VerifiedGuard — gates financial operations behind email verification.
 *
 * Why a separate guard from JwtAuthGuard:
 *   - Authenticated ≠ verified. Under the strict login policy a brand-new
 *     PENDING_VERIFICATION user can't log in at all, so this is mostly a
 *     defense-in-depth check. But it ALSO catches the case where a user
 *     was active, then admin moved them back to PENDING_VERIFICATION for
 *     re-KYC, and their old token is still floating around.
 *   - Lets us scope the verification requirement per-route via
 *     @RequireVerified(). Read-only routes (profile fetch, transaction
 *     history) don't need it; only money-moving routes (sell, buy, swap,
 *     proof upload) do.
 *
 * Why a fresh DB lookup instead of reading from the JWT:
 *   A user who verifies AFTER their token was issued should immediately
 *   gain access to financial endpoints — they shouldn't have to log out
 *   and back in. Reading isEmailVerified from DB each time the guard fires
 *   gives us that. Cost: one extra SELECT per protected request. Acceptable
 *   trade for UX.
 */

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
