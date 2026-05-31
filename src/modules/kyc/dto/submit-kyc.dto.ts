// src/modules/kyc/dto/submit-kyc.dto.ts

/**
 * Body schema for POST /kyc/me.
 *
 * The user submits AT LEAST ONE of (bvn, nin) plus a selfie URL. The service
 * rejects with 400 if neither identity number is provided. Both being present
 * is fine and useful — admin can cross-check against either NIBSS or NIMC
 * later if a provider integration arrives.
 *
 * `selfieUrl` is expected to be a URL the FE already uploaded the image to
 * (Cloudinary, S3, etc.). The backend stores only the URL — never the binary.
 * Validates the URL is HTTPS to prevent accidentally storing http:// links
 * (which would break in browsers under the FE's Secure-cookie context).
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import {
  IsBvn,
  IsNin,
} from '../../../common/validators/is-nigerian-id.decorator';

export class SubmitKycDto {
  @ApiPropertyOptional({
    example: '12345678901',
    description:
      'Bank Verification Number — exactly 11 digits. Optional; either bvn ' +
      'or nin (or both) must be supplied. Stored encrypted (AES-256-GCM) ' +
      'plus a separate HMAC hash for uniqueness checks (see PII rulebook §28).',
  })
  @IsOptional()
  @IsBvn()
  bvn?: string;

  @ApiPropertyOptional({
    example: '12345678901',
    description:
      'National Identification Number — exactly 11 digits. Optional; either ' +
      'bvn or nin (or both) must be supplied. Stored encrypted + hashed same ' +
      'as bvn.',
  })
  @IsOptional()
  @IsNin()
  nin?: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/xchangnow/image/upload/v1234567890/kyc-selfies/abc123.jpg',
    description:
      'HTTPS URL of the selfie image. FE uploads the image to Cloudinary ' +
      '(or wherever you choose) using an unsigned upload preset, then sends ' +
      'the returned URL here. The backend never receives the binary.',
    maxLength: 500,
  })
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  selfieUrl!: string;
}
