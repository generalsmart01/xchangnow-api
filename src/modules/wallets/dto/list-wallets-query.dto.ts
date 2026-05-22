import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class ListWalletsQueryDto {
  @IsOptional()
  @IsEnum(CryptoAsset)
  asset?: CryptoAsset;

  @IsOptional()
  @IsEnum(CryptoNetwork)
  network?: CryptoNetwork;

  // Booleans from query strings arrive as "true" / "false" — class-transformer's
  // @Type(() => Boolean) treats any non-empty string as true. We coerce explicitly.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
