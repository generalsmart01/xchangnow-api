// src/common/validators/is-phone-number-e164.decorator.ts

/**
 * Custom class-validator decorator backed by libphonenumber-js.
 *
 * Why not class-validator's built-in @IsPhoneNumber()?
 *   - @IsPhoneNumber is more lenient (uses google-libphonenumber loose
 *     mode). It will pass strings that libphonenumber-js considers
 *     invalid given a real prefix database (e.g. "+2340000000000").
 *   - We want STRICT validation: only accept numbers that map to a real
 *     country prefix + real subscriber block per the current
 *     libphonenumber metadata.
 *
 * Why not store the normalized form here via @Transform?
 *   - The DTO contract is "phoneNumber = what the user typed". Normalization
 *     is a service-layer concern (services call normalizePhoneE164() before
 *     writing Profile). Keeping validation purely a yes/no check makes the
 *     code path easier to reason about — one phase validates, one phase
 *     normalizes.
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { normalizePhone } from '../utils/normalize-phone';

@ValidatorConstraint({ name: 'IsPhoneNumberE164', async: false })
class IsPhoneNumberE164Constraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true; // @IsOptional handles required-ness
    if (typeof value !== 'string') return false;
    return normalizePhone(value) !== null;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be a valid Nigerian phone number — ` +
      'accepted formats: "08012345678", "8012345678", "2348012345678", ' +
      'or "+2348012345678" (with or without spaces/dashes). ' +
      'International numbers from other countries are not accepted.'
    );
  }
}

/**
 * Validates that a string is a valid phone number when parsed with NG as the
 * default country. Pairs with `normalizePhoneE164()` in services to produce
 * the canonical E.164 form for storage in `Profile.phoneNumberNormalized`.
 *
 * Use alongside `@IsOptional()` when the field is optional (e.g. registration).
 *
 * @example
 *   @IsOptional()
 *   @IsPhoneNumberE164()
 *   phoneNumber?: string;
 */
export function IsPhoneNumberE164(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPhoneNumberE164Constraint,
    });
  };
}
