// src/modules/kyc/kyc.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *  --- User (self) ---
 *
 *   POST   /kyc/me               JWT, body: SubmitKycDto
 *                                201: KycSelfView (status PENDING)
 *                                400: at least one of bvn/nin required
 *                                409: BVN/NIN already used / KYC already approved
 *
 *   GET    /kyc/me               JWT
 *                                200: KycSelfView (own status, no plaintext IDs)
 *
 *  --- Admin (ADMIN | SUPER_ADMIN) ---
 *
 *   GET    /kyc                  query: status / page / pageSize
 *                                200: paginated KycListItem[]
 *                                (PiiAccessLog: KYC_DOCUMENT LIST)
 *
 *   GET    /kyc/:userId          200: KycAdminFullView (DECRYPTED bvn/nin)
 *                                404: profile not found
 *                                (PiiAccessLog: KYC_DOCUMENT READ — most
 *                                 audit-worthy operation in the system)
 *
 *   POST   /kyc/:userId/approve  body: {} (no payload)
 *                                200: KycSelfView (status APPROVED)
 *                                400: not in PENDING
 *                                403: self-approval attempt
 *
 *   POST   /kyc/:userId/reject   body: RejectKycDto (reason required)
 *                                200: KycSelfView (status REJECTED)
 *                                400: not in PENDING
 *                                403: self-rejection attempt
 *
 * Manual review only — no external verification provider. The admin
 * reviews the BVN/NIN + selfie + Profile (firstName/lastName/dateOfBirth)
 * and decides. Once a provider is integrated, the same endpoints can call
 * the provider before / instead of waiting for the admin click.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogMessage } from '../../common/decorators/log-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ListKycQueryDto } from './dto/list-kyc-query.dto';
import { RejectKycDto } from './dto/reject-kyc.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@ApiBearerAuth('JWT-auth')
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  // ============================ user-facing ============================

  @Post('me')
  @LogMessage('KYC submitted')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit KYC for manual review',
    description:
      'Submit at least one of BVN/NIN plus a selfie URL. The backend ' +
      'encrypts the identifiers and queues the submission for admin review. ' +
      "Status flips PENDING; once an admin reviews, you'll get APPROVED or " +
      'REJECTED (with a reason). Rejected? Just resubmit — that flips back ' +
      'to PENDING.\n\n' +
      'The selfie URL should be obtained by uploading the image to ' +
      'Cloudinary (or your chosen image host) from the FE first, then ' +
      'sending the returned URL here.',
  })
  @ApiResponse({ status: 201, description: 'KYC submitted; awaiting review.' })
  @ApiResponse({ status: 400, description: 'At least one of bvn or nin required.' })
  @ApiResponse({
    status: 409,
    description:
      'BVN or NIN already registered to another account, OR KYC already approved.',
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitKycDto,
  ) {
    return this.kyc.submit(user.id, dto);
  }

  @Get('me')
  @LogMessage('Fetched my KYC status')
  @ApiOperation({
    summary: 'Get my KYC status',
    description:
      'Returns the current status (NONE/PENDING/APPROVED/REJECTED) plus the ' +
      'rejection reason if any. Does NOT return your raw BVN/NIN — the user ' +
      'already knows their own numbers and the API never exposes them.',
  })
  @ApiResponse({ status: 200, description: 'KYC status.' })
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.getOwn(user.id);
  }

  // ============================ admin-facing ============================

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed KYC submissions (admin)')
  @ApiOperation({
    summary: '(Admin) List KYC submissions',
    description:
      'Paginated list, default sort oldest-first within the chosen status ' +
      'so admins clear the queue fairly. Filter by `status` (typically ' +
      'PENDING for the review queue).',
  })
  @ApiResponse({ status: 200, description: 'Paginated KYC submissions.' })
  listAll(
    @CurrentUser() admin: AuthenticatedUser,
    @Query() query: ListKycQueryDto,
  ) {
    return this.kyc.listForAdmin(admin.id, query);
  }

  @Get(':userId')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Fetched KYC submission (admin)')
  @ApiOperation({
    summary: '(Admin) Get one KYC submission with decrypted BVN/NIN',
    description:
      'Returns the full review payload INCLUDING decrypted BVN/NIN so admin ' +
      'can verify against the selfie. Decryption is logged in PiiAccessLog ' +
      'with action=READ — the most audit-worthy operation in the system.',
  })
  @ApiResponse({ status: 200, description: 'Full KYC record with decrypted IDs.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  findOne(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.kyc.findForAdmin(admin.id, userId);
  }

  @Post(':userId/approve')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('KYC approved (admin)')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '(Admin) Approve a KYC submission',
    description:
      'Flips status to APPROVED, stamps reviewedAt + reviewedById. ' +
      'Writes admin_log + security_log (MEDIUM). Refused if not currently ' +
      'PENDING (approving an already-APPROVED account is a no-op that ' +
      'would muddy the audit).',
  })
  @ApiResponse({ status: 200, description: 'KYC approved.' })
  @ApiResponse({ status: 400, description: 'Not in PENDING status.' })
  @ApiResponse({ status: 403, description: 'Self-approval attempt.' })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.kyc.approve(admin.id, userId);
  }

  @Post(':userId/reject')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('KYC rejected (admin)')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '(Admin) Reject a KYC submission with a reason',
    description:
      'Flips status to REJECTED, stores rejectionReason. User can resubmit ' +
      "— that flips back to PENDING. Reason is surfaced to the user so they " +
      'know what to fix.',
  })
  @ApiResponse({ status: 200, description: 'KYC rejected.' })
  @ApiResponse({ status: 400, description: 'Not in PENDING status.' })
  @ApiResponse({ status: 403, description: 'Self-rejection attempt.' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: RejectKycDto,
  ) {
    return this.kyc.reject(admin.id, userId, dto.reason);
  }
}
