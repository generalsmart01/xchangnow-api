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

  // Called only if signature verification + expiry check passed.
  // Returned value becomes req.user.
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
