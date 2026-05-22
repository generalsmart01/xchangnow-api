import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Address / asset / network are NOT updatable. Changing those would
// break the address ↔ transaction relationship. Delete and recreate instead.
export class UpdateWalletDto {
  @ApiPropertyOptional({
    example: 'BTC retired wallet',
    description: 'New label.',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Set false to take this wallet out of `pickActiveWallet` rotation ' +
      '(retire it). Historical transactions remain linked.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
