// src/modules/auth/guards/jwt.guard.ts

/**
 * JwtAuthGuard — applied to any route that requires authentication.
 *
 * Thin extension of Passport's AuthGuard that delegates to JwtStrategy
 * (registered with the name 'jwt' in AuthModule). The actual logic lives
 * in JwtStrategy.validate() — this class exists so consumers can write
 * `@UseGuards(JwtAuthGuard)` instead of `@UseGuards(AuthGuard('jwt'))`.
 *
 * On rejection: 401 with the Passport default message. Wrapped by the
 * AllExceptionsFilter into the standard error envelope.
 */

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
