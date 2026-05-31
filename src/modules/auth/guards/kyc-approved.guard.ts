// src/modules/auth/guards/kyc-approved.guard.ts

/**
 * KycApprovedGuard — gates routes behind Profile.kycStatus === APPROVED.
 *
 * Only enforces when @RequireKycApproved() is present on the handler or
 * class. Pair with JwtAuthGuard upstream so request.user is populated.
 *
 * Uses a fresh DB lookup (not from JWT) so a user who gets KYC-approved
 * AFTER their token was issued gains access immediately, no re-login.
 * Same pattern as VerifiedGuard.
 *
 * Cost: one extra SELECT (profile.kycStatus by userId) per protected
 * request. Acceptable trade for UX; if hot-path traffic ever justifies
 * caching, the JWT could carry a `kycStatus` claim refreshed on each
 * /auth/refresh call.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KycStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { REQUIRE_KYC_APPROVED_KEY } from '../decorators/require-kyc-approved.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class KycApprovedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_KYC_APPROVED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // Should be impossible — JwtAuthGuard runs first.
      throw new ForbiddenException('Authentication required');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { kycStatus: true },
    });

    if (!profile || profile.kycStatus !== KycStatus.APPROVED) {
      throw new ForbiddenException(
        'KYC verification required. Submit KYC at POST /kyc/me and wait for ' +
          'admin approval before performing this action.',
      );
    }

    return true;
  }
}
