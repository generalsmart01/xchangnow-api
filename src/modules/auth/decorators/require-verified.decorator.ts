import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as requiring the user's email to be verified.
 * Enforced by VerifiedGuard. Has no effect unless that guard is in the chain.
 */
export const REQUIRE_VERIFIED_KEY = 'requireVerified';

export const RequireVerified = () => SetMetadata(REQUIRE_VERIFIED_KEY, true);
