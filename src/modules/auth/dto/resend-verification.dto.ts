import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @ApiProperty({
    example: 'michael@xchangenow.com',
    description:
      'Email of the unverified account. Response is the same regardless of ' +
      'whether the account exists or is already verified — by design, to avoid ' +
      'account enumeration.',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
