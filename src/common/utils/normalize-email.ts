// src/common/utils/normalize-email.ts

/**
 * Single source of truth for converting a raw email input into the canonical
 * form stored in User.emailNormalized.
 *
 * Current rules: lowercase + trim. Minimal but enough to defeat the most
 * common case-variant duplicate issue ("USER@x.com" registering twice).
 *
 * Future hardening (deliberately NOT applied today, product decision):
 *   - Strip `+tag` from Gmail-style local-parts ("user+a@gmail.com" →
 *     "user@gmail.com") to prevent alias-based account farming
 *   - Strip dots from Gmail local-parts ("u.s.e.r@gmail.com" → "user@gmail.com")
 *   - Reject disposable email domains (mailinator, 10minutemail, etc.)
 * These would block legitimate users who rely on plus-addressing for
 * organization, so we keep them off until the product makes a decision.
 */

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Normalize an email address for storage in `User.emailNormalized` and for
 * use as a lookup key. Returns null when the input is empty/null/whitespace
 * or doesn't look like a valid email shape.
 *
 * The shape check here is INTENTIONALLY lenient — class-validator's @IsEmail
 * decorator on the DTO is the real gate. This shape check exists only so
 * that callers passing weird strings (e.g. system migration scripts) don't
 * silently store garbage as the lookup key.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (!EMAIL_SHAPE.test(lower)) return null;
  return lower;
}
