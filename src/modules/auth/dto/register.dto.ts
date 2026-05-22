import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'michael@xchangenow.com',
    description: 'Valid email address. Must be unique.',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'StrongP@ss1',
    description:
      'Must be 8-128 chars and contain at least one uppercase letter, ' +
      'one lowercase letter, and one number.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/, {
    message:
      'Password must contain an uppercase letter, a lowercase letter, and a number',
  })
  password!: string;

  @ApiProperty({
    example: 'Michael',
    description: 'First / given name. Used on KYC and bank payouts.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({
    example: 'Adeleke',
    description: 'Last / family name. Used on KYC and bank payouts.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Optional phone in E.164 format. Unique across users when set.',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;
}
