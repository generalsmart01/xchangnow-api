// src/modules/auth/strategies/jwt.strategy.ts

/**
 * JwtStrategy — Passport strategy for Bearer-token auth on every protected
 * route. Registered globally by AuthModule; activated per-route via
 * @UseGuards(JwtAuthGuard).
 *
 * Two-step validation:
 *   1. Passport itself: signature check + expiry check using JWT_ACCESS_SECRET.
 *      Fails here → 401 returned to client without ever calling `validate`.
 *   2. `validate(payload)`: server-side session check via AuthService. Catches
 *      tokens that are cryptographically valid but reference a revoked or
 *      expired session row (e.g. user logged out, password was reset on
 *      another device, admin force-revoked their sessions).
 *
 * Why we keep the second step: JWTs are stateless by design, but for an
 * app where we need "log out from all devices" + "password reset revokes
 * all sessions", we have to be able to invalidate live tokens. The session
 * row is the revocation handle.
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Called by Passport only if the JWT signature + expiry already passed.
   * The return value becomes `req.user` on every downstream handler.
   *
   * @throws UnauthorizedException 401 — session is revoked / expired /
   *   doesn't belong to this user (anti-token-replay safety net)
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const session = await this.authService.validateSession(
      payload.sessionId,
      payload.sub,
    );
    if (!session) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  }
}
