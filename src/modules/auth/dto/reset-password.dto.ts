import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  // bcrypt truncates beyond 72 bytes — enforce that upper bound so users
  // don't silently lose entropy after the 73rd character.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
