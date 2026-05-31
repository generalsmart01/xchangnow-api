// src/modules/kyc/dto/reject-kyc.dto.ts

/**
 * Body schema for POST /kyc/:userId/reject (admin).
 *
 * Reason is mandatory — surfaced back to the user so they understand what to
 * fix on resubmission ("selfie too blurry, please retake", "BVN doesn't match
 * the name on profile", etc.). 5-500 chars; deliberate floor so admins can't
 * leave a useless "no" reason.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectKycDto {
  @ApiProperty({
    example: 'Selfie is too blurry to verify against the BVN photo. Please retake in better lighting.',
    description:
      'Mandatory human-readable rejection reason (5-500 chars). Stored on ' +
      'profile.kycRejectionReason and shown to the user so they know how to ' +
      'fix the submission.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
