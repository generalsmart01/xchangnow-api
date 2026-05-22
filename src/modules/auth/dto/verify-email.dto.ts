import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'kZ8a3bcD-fGh4iJkLmNoPqRsTuVwXyZ0123456789abcdef',
    description:
      'The opaque token that came in the verification email link ' +
      '(or, in dev mode, in the `verifyToken` field of the register response).',
    minLength: 20,
    maxLength: 200,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
