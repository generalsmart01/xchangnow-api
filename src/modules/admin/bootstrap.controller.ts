// src/modules/admin/bootstrap.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *   POST   /admin/bootstrap       public — no JWT
 *                                 body: BootstrapSuperAdminDto
 *                                 201: SafeUser (the newly minted SUPER_ADMIN)
 *                                 400: validation error / invalid email
 *                                 403: bootstrap secret mismatch
 *                                 404: BOOTSTRAP_SECRET env var unset
 *                                      (endpoint pretends not to exist)
 *                                 409: SUPER_ADMIN already exists OR
 *                                      email already registered
 *
 * Intentionally OUTSIDE the AdminController's @UseGuards(JwtAuthGuard) chain —
 * this endpoint cannot be JWT-gated because by definition no SUPER_ADMIN
 * exists yet to authenticate against. Defense is the shared `BOOTSTRAP_SECRET`
 * env var (timing-safe compared) + single-use enforcement.
 *
 * Best practice: REMOVE BOOTSTRAP_SECRET from your prod env after first
 * successful bootstrap. The endpoint becomes a permanent 404.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogMessage } from '../../common/decorators/log-message.decorator';
import { BootstrapService } from './bootstrap.service';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';

const BOOTSTRAP_USER_EXAMPLE = {
  id: 'cmpn6qabe0000o8n86fsgc2fi',
  email: 'admin@xchangnow.com',
  firstName: 'Super',
  lastName: 'Admin',
  phoneNumber: null,
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  isEmailVerified: true,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: '2026-05-30T10:00:00.000Z',
  updatedAt: '2026-05-30T10:00:00.000Z',
  deletedAt: null,
};

@ApiTags('Admin — Bootstrap')
@Controller('admin')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post('bootstrap')
  @LogMessage('SUPER_ADMIN bootstrapped')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bootstrap the first SUPER_ADMIN (one-time, secret-gated)',
    description:
      '**One-time, public endpoint** for minting the very first SUPER_ADMIN.\n\n' +
      'Use this when you cannot run `prisma db seed` (e.g. Render free tier ' +
      "with no shell access). It's an HTTP-driven alternative to the seed-" +
      'script bootstrap; the two paths coexist — whichever runs first wins, ' +
      'the other becomes a no-op.\n\n' +
      '**How to use:**\n' +
      '1. Generate a strong secret:\n' +
      '   ```\n' +
      '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
      '   ```\n' +
      '2. Set it in your env as `BOOTSTRAP_SECRET`.\n' +
      '3. POST this endpoint with that same secret + the SUPER_ADMIN\'s ' +
      'email/password/name in the body.\n' +
      '4. Confirm you can log in via `POST /auth/login`.\n' +
      '5. **Remove `BOOTSTRAP_SECRET` from prod env** — the endpoint then ' +
      'permanently returns 404.\n\n' +
      '**Safety properties:**\n' +
      '- Returns 404 if `BOOTSTRAP_SECRET` env is unset (URL appears unmapped)\n' +
      '- Returns 403 on secret mismatch (timing-safe compare)\n' +
      '- Returns 409 once any SUPER_ADMIN exists (single-use)\n' +
      '- Every attempt (success OR failure) writes a HIGH-severity ' +
      '`security_log` row for forensic review\n\n' +
      '**Do NOT use this for:** subsequent SUPER_ADMIN creation, regular ' +
      'staff onboarding (use `POST /admin/staff`), or any non-bootstrap flow.',
  })
  @ApiBody({
    type: BootstrapSuperAdminDto,
    description:
      'Bootstrap payload. `secret` MUST match the BOOTSTRAP_SECRET env var ' +
      'exactly (timing-safe compare). All other fields are the SUPER_ADMIN ' +
      "credentials you want to create.",
  })
  @ApiResponse({
    status: 201,
    description:
      'SUPER_ADMIN created. You can now POST /auth/login with the supplied ' +
      'credentials. Remember to REMOVE BOOTSTRAP_SECRET from env now.',
    schema: { example: BOOTSTRAP_USER_EXAMPLE },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error — see `error.details[]` for per-field messages.',
  })
  @ApiResponse({
    status: 403,
    description:
      'The supplied `secret` does not match `BOOTSTRAP_SECRET`. Failed ' +
      'attempts are logged with HIGH severity in security_logs.',
  })
  @ApiResponse({
    status: 404,
    description:
      '`BOOTSTRAP_SECRET` env var is not set. Endpoint pretends not to exist. ' +
      'This is the response after a successful bootstrap + env var removal.',
  })
  @ApiResponse({
    status: 409,
    description:
      'A SUPER_ADMIN already exists, OR the supplied email is already ' +
      'registered to another account. Bootstrap is single-use by design.',
  })
  async bootstrap(@Body() dto: BootstrapSuperAdminDto) {
    return this.bootstrapService.bootstrapSuperAdmin(dto);
  }
}
