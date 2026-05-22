import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../../integrations/email/email.module';
import { SecurityModule } from '../security/security.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
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
  providers: [AuthService, JwtStrategy, VerifiedGuard],
  exports: [AuthService, VerifiedGuard],
})
export class AuthModule {}
