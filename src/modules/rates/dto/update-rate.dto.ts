import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Only buyRate / sellRate / source are mutable on an existing snapshot.
// Asset and fiatCurrency are identity; if they need to change, delete + create.
export class UpdateRateDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(20)
  buyRate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(20)
  sellRate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
