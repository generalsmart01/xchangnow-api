// src/modules/auth/auth.module.ts

/**
 * AuthModule — wires the authentication feature.
 *
 * Provides:
 *   - AuthService    (exported — consumed by other modules, notably StaffService)
 *   - JwtStrategy    (Passport strategy class; registered globally via passport
 *                    so any module can use @UseGuards(JwtAuthGuard))
 *   - VerifiedGuard  (exported — needs DI of PrismaService + Reflector; other
 *                    modules import this guard via @UseGuards(VerifiedGuard))
 *
 * Imports:
 *   - PassportModule          required by NestJS Passport integration
 *   - JwtModule.registerAsync access-token signing config (secret + expiry)
 *                             read from env at boot via ConfigService
 *   - SecurityModule          exposes SecurityService for the pre-login risk gate
 *   - EmailModule             exposes EmailService for verify / reset / invite emails
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../../integrations/email/email.module';
import { SecurityModule } from '../security/security.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KycApprovedGuard } from './guards/kyc-approved.guard';
import { VerifiedGuard } from './guards/verified.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          // env value is `string`; @nestjs/jwt v11 wants `ms` StringValue literal — safe runtime cast.
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as unknown as number,
        },
      }),
    }),
    SecurityModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, VerifiedGuard, KycApprovedGuard],
  exports: [AuthService, VerifiedGuard, KycApprovedGuard],
})
export class AuthModule {}
