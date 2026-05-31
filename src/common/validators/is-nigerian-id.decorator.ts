// src/common/validators/is-nigerian-id.decorator.ts

/**
 * Format validators for Nigerian identity numbers.
 *   - BVN (Bank Verification Number): exactly 11 digits
 *   - NIN (National Identification Number): exactly 11 digits
 *
 * Both share the same surface format (11 numeric digits) so they share a
 * single underlying validator. Exposed as two separate decorators because
 * they're conceptually different fields and the DTO reads cleaner.
 *
 * What this does NOT do:
 *   - Does NOT verify the number against NIBSS / NIMC (that's a runtime API
 *     call during KYC review, not a request-time validation step)
 *   - Does NOT detect "fake-looking" patterns like "11111111111" — accepted
 *     as false positives because NIBSS will reject them at verify time
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const ELEVEN_DIGITS = /^\d{11}$/;

@ValidatorConstraint({ name: 'IsNigerianId11Digit', async: false })
class IsNigerianId11DigitConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true; // @IsOptional handles required-ness
    if (typeof value !== 'string') return false;
    return ELEVEN_DIGITS.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be exactly 11 digits (numeric only)`;
  }
}

/**
 * Validates a Nigerian BVN format (11 digits).
 *
 * @example
 *   @IsOptional()
 *   @IsBvn()
 *   bvn?: string;
 */
export function IsBvn(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNigerianId11DigitConstraint,
    });
  };
}

/**
 * Validates a Nigerian NIN format (11 digits).
 *
 * @example
 *   @IsOptional()
 *   @IsNin()
 *   nin?: string;
 */
export function IsNin(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNigerianId11DigitConstraint,
    });
  };
}
