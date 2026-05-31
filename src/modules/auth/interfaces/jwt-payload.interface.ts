// src/modules/auth/interfaces/jwt-payload.interface.ts

/**
 * Shapes the access-token payload and the request-bound user identity.
 *
 *   JwtPayload        = what we SIGN into the JWT
 *   AuthenticatedUser = what JwtStrategy.validate produces → req.user
 *
 * The two shapes are intentionally close but renamed: `sub` (JWT standard
 * subject claim) becomes `id` for ergonomic downstream code.
 */

import { Role } from '../enums/role.enum';

/**
 * The signed JWT body. Kept minimal — every field bloats the access token
 * and ends up on every request as Authorization header overhead.
 *
 *   sub        user id (standard JWT "subject" claim)
 *   email      cached for cheap req-time access without a DB hit
 *   role       cached for role-guard checks without a DB hit
 *   sessionId  ties the JWT to a revocable server-side session row; lets us
 *              invalidate live tokens on logout / password reset
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  sessionId: string;
}

/**
 * The shape attached to `request.user` after JwtStrategy.validate runs.
 * Available in any route via @CurrentUser().
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}
