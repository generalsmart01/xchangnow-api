import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example:
      'eEt8r2Vh3LkPq9aBxNm-zQ4cF5sJ7uYg8WdRtHbXjAvKp1Nc6QzMeUyT0gWiOvLs',
    description:
      'The `refreshToken` you received from POST /auth/login (or the most recent /auth/refresh). ' +
      'Single-use — the server rotates this on every successful refresh.',
  })
  @IsString()
  refreshToken!: string;
}
