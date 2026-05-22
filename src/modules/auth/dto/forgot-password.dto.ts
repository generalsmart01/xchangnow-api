import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'michael@xchangenow.com',
    description:
      'Email of the account that forgot its password. Response is generic ' +
      "regardless of whether the email exists — don't leak account existence.",
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
