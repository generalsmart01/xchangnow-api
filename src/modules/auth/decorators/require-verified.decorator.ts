// src/modules/auth/decorators/require-verified.decorator.ts

/**
 * @RequireVerified() — marks a route as requiring email verification.
 * Enforced by VerifiedGuard, which does a fresh DB lookup of
 * `isEmailVerified` (not from the JWT, so a just-verified user doesn't
 * have to re-login).
 *
 * Used on money-moving routes (sell, buy, swap, proof upload).
 * Has no effect unless VerifiedGuard is in the guard chain.
 *
 * @example
 *   @Post('sell')
 *   @RequireVerified()
 *   @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
 *   createSell(...) { ... }
 */

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_KEY = 'requireVerified';

export const RequireVerified = () => SetMetadata(REQUIRE_VERIFIED_KEY, true);
