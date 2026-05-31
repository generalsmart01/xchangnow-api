// src/modules/auth/decorators/require-kyc-approved.decorator.ts

/**
 * @RequireKycApproved() — marks a route as requiring the user's KYC to be
 * APPROVED. Enforced by KycApprovedGuard; no-op otherwise.
 *
 * Built but NOT YET APPLIED to any route. When you're ready to require KYC
 * for transactions, just add this decorator + add KycApprovedGuard to the
 * controller's @UseGuards chain. Example:
 *
 *   @Post('sell')
 *   @RequireVerified()        // email verified (existing)
 *   @RequireKycApproved()     // KYC approved (new)
 *   @UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard, KycApprovedGuard)
 *   createSell(...) { ... }
 *
 * Until applied, KYC is informational only — submitting KYC sets a status
 * but doesn't gate any operation. This gives you a soft launch path:
 * collect KYC data first, ENFORCE it once the queue is reliably reviewed.
 */

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_KYC_APPROVED_KEY = 'requireKycApproved';

export const RequireKycApproved = () =>
  SetMetadata(REQUIRE_KYC_APPROVED_KEY, true);
