import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/, {
    message: 'Password must contain an uppercase letter, a lowercase letter, and a number',
  })
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;
}
