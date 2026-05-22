import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Address / asset / network are NOT updatable. Changing those would
// break the address ↔ transaction relationship. Delete and recreate instead.
export class UpdateWalletDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
