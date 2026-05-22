import { ProofType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UploadProofDto {
  @IsEnum(ProofType)
  type!: ProofType;

  // URL of bank receipt OR on-chain tx hash, depending on type.
  // Service validates the value matches the type semantically.
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
