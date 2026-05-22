import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService, SessionContext } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';

// Shared response shapes used across endpoints for richer Swagger examples.
const AUTH_USER_EXAMPLE = {
  id: 'cmpgx5qjh0000o85kzmyj8zpy',
  email: 'michael@xchangenow.com',
  phoneNumber: '+2348012345678',
  firstName: 'Michael',
  lastName: 'Adeleke',
  role: 'USER',
  status: 'PENDING_VERIFICATION',
  isEmailVerified: false,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: '2026-05-22T13:00:00.000Z',
  updatedAt: '2026-05-22T13:00:00.000Z',
  deletedAt: null,
};

const AUTH_TOKENS_EXAMPLE = {
  accessToken: 'eyJhbGciOiJIUzI1NiIs...truncated...',
  refreshToken: 'eEt8r2Vh3LkPq9aBxNm-zQ4cF5sJ7uYg8WdRtHbXjAvKp1Nc6QzMeUyT0gWiOvLs',
  accessExpiresIn: '15m',
  refreshExpiresIn: '7d',
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new user with `status=PENDING_VERIFICATION` and `isEmailVerified=false`, ' +
      'issues access + refresh tokens immediately (so the client can navigate the app), ' +
      'and sends a verification email. ' +
      'In dev mode (`NODE_ENV !== "production"`) the response also includes the raw ' +
      '`verifyToken` so tests can complete the flow without scraping email logs. ' +
      'Note: financial endpoints (sell/buy/swap/proof) are blocked until the email is verified.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created.',
    schema: {
      example: {
        user: AUTH_USER_EXAMPLE,
        tokens: AUTH_TOKENS_EXAMPLE,
        verifyToken: 'a1b2c3d4...DEV-ONLY...xyz', // only present when NODE_ENV != production
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (e.g. weak password, malformed email).',
  })
  @ApiResponse({
    status: 409,
    description: 'Email already registered.',
  })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.context(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email + password',
    description:
      'Returns access + refresh tokens. Also runs the security gate first — if ' +
      'the IP / brute-force risk score is CRITICAL, returns 401 without ever ' +
      'checking the password. Updates `lastLoginAt` + `lastLoginIp` on success.',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful.',
    schema: {
      example: {
        user: { ...AUTH_USER_EXAMPLE, status: 'ACTIVE', isEmailVerified: true, lastLoginAt: '2026-05-22T14:30:00.000Z' },
        tokens: AUTH_TOKENS_EXAMPLE,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      'Invalid credentials, account not active (suspended/deactivated), or ' +
      'blocked by security (too many recent failed attempts from this IP/email).',
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.context(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate an access token using a refresh token',
    description:
      'Returns a NEW pair of access + refresh tokens. The old refresh token is ' +
      'revoked atomically — using it again returns 401. This is refresh-token ' +
      'rotation, the standard defence against token theft.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens rotated.',
    schema: { example: { tokens: AUTH_TOKENS_EXAMPLE } },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid / revoked / expired.',
  })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.context(req));
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out — revoke the current session',
    description:
      'Revokes the session that the access token belongs to. Other active ' +
      'sessions for the same user (e.g. another device) are NOT affected. ' +
      'No body needed.',
  })
  @ApiResponse({ status: 204, description: 'Session revoked.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  async logout(@CurrentUser('sessionId') sessionId: string): Promise<void> {
    await this.auth.logout(sessionId);
  }

  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get the current user from the access token',
    description:
      'Returns the user info embedded in the JWT plus the `sessionId`. ' +
      'For full profile data (with phoneNumber, status, etc.) use GET /users/me.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authenticated user identity.',
    schema: {
      example: {
        id: 'cmpgx5qjh0000o85kzmyj8zpy',
        email: 'michael@xchangenow.com',
        role: 'USER',
        sessionId: 'cmpg9k3lk0009o84wjn521kk4',
      },
    },
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the email address',
    description:
      'Consumes the verification token from the email link. On success: ' +
      "user's `isEmailVerified` becomes `true`, `status` advances from " +
      'PENDING_VERIFICATION to ACTIVE, and all of this user’s outstanding ' +
      'verification tokens are deleted (one-shot semantics).',
  })
  @ApiResponse({
    status: 200,
    description: 'Email verified.',
    schema: { example: { message: 'Email verified' } },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend the email verification message',
    description:
      'Issues a fresh verification token and emails it. Invalidates any prior ' +
      'verification tokens for this user. ' +
      '**The response is intentionally generic** — same 200 with the same message ' +
      'whether the email exists, is already verified, or has been deleted. This ' +
      'prevents attackers from probing which addresses are registered.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generic acknowledgement.',
    schema: {
      example: {
        message: 'If the account exists and is unverified, a new email has been sent',
      },
    },
  })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start a password reset',
    description:
      'Generates a 1-hour password reset token and emails it. Invalidates any ' +
      'prior reset tokens for this user. ' +
      '**Generic response** — same 200 message regardless of whether the email ' +
      'is registered (prevents account enumeration). ' +
      'In dev mode the response also includes the raw `resetToken` for testing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generic acknowledgement (and `resetToken` in dev mode).',
    schema: {
      example: {
        message: 'If an account exists for that email, a reset link has been sent',
        resetToken: 'a1b2c3d4...DEV-ONLY...xyz',
      },
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finalise a password reset',
    description:
      "Sets the user's new password (bcrypt-hashed) and atomically: " +
      '(1) marks the reset token as used (`usedAt` timestamp); ' +
      '(2) revokes ALL active sessions for the user (forces re-login on every device); ' +
      '(3) writes a `PASSWORD_RESET` row to `security_logs`. ' +
      'After this call the old refresh tokens cannot be exchanged anymore.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset complete.',
    schema: {
      example: {
        message: 'Password reset successful. Please log in with your new password.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Token invalid (unknown), already used, or expired (>1 hour after issue).',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  /**
   * Pulls IP + UA from the request so the SecurityService can score the login
   * and so we can stamp them onto session + login_attempt audit rows.
   */
  private context(req: Request): SessionContext {
    return {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }
}
