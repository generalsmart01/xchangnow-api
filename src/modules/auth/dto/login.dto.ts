import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'michael@xchangenow.com',
    description: 'Registered email (case-insensitive).',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongP@ss1',
    description: 'The password supplied at registration.',
  })
  @IsString()
  password!: string;
}
