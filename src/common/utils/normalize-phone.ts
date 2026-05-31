// src/common/utils/normalize-phone.ts

/**
 * Nigerian-only phone normalizer. The platform currently accepts NG numbers
 * exclusively — country code +234 is implicit. International callers can
 * be added later by relaxing this utility.
 *
 * Single source of truth for parsing + normalizing phone numbers to E.164.
 * Used by:
 *   - the @IsPhoneNumberE164() validator decorator (validation pass)
 *   - services writing Profile (to populate phoneNumberNormalized at create
 *     / update time)
 *
 * Accepted input variants — all normalize to "+2348012345678":
 *     "08012345678"           (NG local with leading 0, 11 digits)
 *     "0801 234 5678"         (with spaces)
 *     "0801-234-5678"         (with dashes)
 *     "8012345678"            (NG local without leading 0, 10 digits)
 *     "2348012345678"         (NG E.164 without `+`)
 *     "+2348012345678"        (NG E.164)
 *     "+234 801 234 5678"     (NG E.164 spaced)
 *
 * Rejected:
 *     "+14155550100"          (US — not NG)
 *     "+447911..."            (UK — not NG)
 *     "0801"                  (too short for an NG mobile)
 *     "0000000000"            (not a real NG prefix)
 *     "hello"                 (not digits)
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';

const NG_DIAL_CODE = '+234';

export interface NormalizedPhone {
  /** What the user typed, trimmed (preserved for display). */
  input: string;
  /** Canonical E.164 form ("+2348012345678"). */
  e164: string;
}

/**
 * Pre-normalize user input into a candidate E.164 string for libphonenumber-js
 * to validate. Returns null if the input is obviously not a Nigerian number
 * shape (e.g. starts with `+1`).
 *
 * Steps:
 *   1. Strip whitespace, dashes, parentheses
 *   2. If starts with `+` — must be `+234`, otherwise REJECT (non-NG)
 *   3. If starts with `234` — prepend `+`
 *   4. If starts with `0` — strip the 0, prepend `+234` (NG trunk prefix)
 *   5. Otherwise (bare digits, e.g. "8012345678") — prepend `+234`
 */
function toNigerianCandidate(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) {
    // International prefix supplied — must be Nigerian or we reject.
    return cleaned.startsWith(NG_DIAL_CODE) ? cleaned : null;
  }
  if (cleaned.startsWith('234')) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    return `${NG_DIAL_CODE}${cleaned.slice(1)}`;
  }
  // Bare digits — assume NG local without the leading 0 (e.g. "8012345678").
  // Only accept if it's all digits; anything else means garbage input.
  if (!/^\d+$/.test(cleaned)) return null;
  return `${NG_DIAL_CODE}${cleaned}`;
}

/**
 * Parse + validate a phone string as a Nigerian number. Returns the normalized
 * form on success, null on failure. Pure function — never throws.
 */
export function normalizePhone(input: string | null | undefined): NormalizedPhone | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = toNigerianCandidate(trimmed);
  if (!candidate) return null;

  const parsed = parsePhoneNumberFromString(candidate);
  if (!parsed) return null;
  if (!parsed.isValid()) return null;
  // Belt-and-suspenders: libphonenumber-js should already reject non-NG via
  // the prefix check, but verify the parsed country to be sure.
  if (parsed.country !== 'NG') return null;

  return {
    input: trimmed,
    e164: parsed.number, // libphonenumber-js returns the E.164 form here
  };
}

/**
 * Convenience: just the E.164 string, or null if invalid.
 * Useful in services that only need the canonical form.
 */
export function normalizePhoneE164(input: string | null | undefined): string | null {
  return normalizePhone(input)?.e164 ?? null;
}
