import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890reset-token',
    description:
      'The reset token from the password-reset email (or `resetToken` field ' +
      'returned by POST /auth/forgot-password in dev). Single-use, 1-hour TTL.',
    minLength: 20,
    maxLength: 200,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    example: 'NewStr0ng!Pass',
    description:
      'New password. 8-72 chars (bcrypt truncates after 72 bytes, so we cap ' +
      'there to avoid silent entropy loss).',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
