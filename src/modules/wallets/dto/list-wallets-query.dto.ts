import { ApiPropertyOptional } from '@nestjs/swagger';
import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class ListWalletsQueryDto {
  @ApiPropertyOptional({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Filter by asset.',
  })
  @IsOptional()
  @IsEnum(CryptoAsset)
  asset?: CryptoAsset;

  @ApiPropertyOptional({
    enum: CryptoNetwork,
    example: CryptoNetwork.BITCOIN,
    description: 'Filter by network.',
  })
  @IsOptional()
  @IsEnum(CryptoNetwork)
  network?: CryptoNetwork;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter active vs retired. Pass literal `true` or `false`.',
  })
  // Booleans from query strings arrive as "true" / "false" — class-transformer's
  // @Type(() => Boolean) treats any non-empty string as true. We coerce explicitly.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
