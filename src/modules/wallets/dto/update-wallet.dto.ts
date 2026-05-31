// src/modules/wallets/dto/update-wallet.dto.ts

/**
 * Body schema for PATCH /wallets/:id (admin).
 *
 * Only `label` and `isActive` are mutable. address/asset/network are
 * effectively identity fields — changing them would orphan historical
 * transactions that reference the wallet. To "change" an address: deactivate
 * the old wallet, create a new one.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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
