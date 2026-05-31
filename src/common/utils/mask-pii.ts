// src/common/utils/mask-pii.ts

/**
 * PII masking helpers for response payloads.
 *
 * Per the PII rulebook §29: full phone numbers and full bank account
 * numbers should not appear in normal API responses. Admin views show
 * MASKED versions; only the user themselves (and the payout-processing
 * code path) sees the real values.
 *
 * Field-name convention: masked variants use a different field name
 * (`phoneNumberMasked` instead of `phoneNumber`, `accountNumberMasked`
 * instead of `accountNumber`). This is intentional — it prevents the FE
 * from accidentally storing a masked value as if it were the real one
 * (e.g. "I'll use this account number to verify a transfer" → the user's
 * transfer gets sent to `******6789` which is nobody's account).
 *
 * Masking heuristic:
 *   - Account number: show last 4 digits, asterisks for the rest
 *       "0123456789" → "******6789"
 *   - Phone (E.164): keep country code + last 4 digits
 *       "+2348012345678" → "+234***5678"
 *       "+14155550100"   → "+1***0100"
 *
 * Short inputs (too short to safely show any suffix) are masked entirely.
 */

import { BankAccount, Profile, User } from '@prisma/client';
import { flattenUser, SafeUser } from './flatten-user';

// ---------------------------------------------------------------------------
// Primitive maskers
// ---------------------------------------------------------------------------

/**
 * Mask a bank account number: last 4 digits visible, rest as asterisks.
 *   "0123456789" → "******6789"
 *   "1234"       → "****"        (too short — mask entirely)
 *   "" or null   → ""
 */
export function maskAccountNumber(accountNumber: string | null | undefined): string {
  if (!accountNumber) return '';
  if (accountNumber.length <= 4) return '*'.repeat(accountNumber.length);
  const lastFour = accountNumber.slice(-4);
  const stars = '*'.repeat(accountNumber.length - 4);
  return stars + lastFour;
}

/**
 * Mask an E.164 phone number: keep country prefix + last 4 digits.
 *   "+2348012345678" → "+234***5678"
 *   "+14155550100"   → "+1***0100"
 *   short / unusual  → masked safely without leaking digits
 */
export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.length <= 8) {
    // Too short to safely split into prefix + suffix without revealing
    // most of the number. Mask the lot, preserving only the leading `+`
    // if present.
    return phone.startsWith('+') ? '+' + '*'.repeat(phone.length - 1) : '*'.repeat(phone.length);
  }
  // Extract country code: `+` followed by 1-3 digits.
  const match = /^(\+\d{1,3})/.exec(phone);
  const prefix = match?.[1] ?? phone.slice(0, 4);
  const lastFour = phone.slice(-4);
  return `${prefix}***${lastFour}`;
}

// ---------------------------------------------------------------------------
// Object-level transformers (drop the raw field, add the masked one)
// ---------------------------------------------------------------------------

export type BankAccountMasked = Omit<BankAccount, 'accountNumber'> & {
  accountNumberMasked: string;
};

/**
 * Convert a BankAccount row into its masked-response shape:
 * drops `accountNumber`, adds `accountNumberMasked`. The `accountName` field
 * is left visible — it's typically the user's own name and is needed for
 * admin verification ("does the name on the proof match the account name?").
 */
export function maskBankAccount(account: BankAccount): BankAccountMasked {
  const { accountNumber, ...rest } = account;
  return { ...rest, accountNumberMasked: maskAccountNumber(accountNumber) };
}

export type SafeUserMasked = Omit<SafeUser, 'phoneNumber'> & {
  phoneNumberMasked: string | null;
};

/**
 * Like flattenUser, but for admin response shapes: drops `phoneNumber`,
 * adds `phoneNumberMasked`. Email is left fully visible — emails are
 * already the primary user identifier (and the admin needs to read it
 * for support workflows).
 */
export function flattenUserMasked(
  user: User & { profile?: Profile | null },
): SafeUserMasked {
  const flat = flattenUser(user);
  const { phoneNumber, ...rest } = flat;
  return {
    ...rest,
    phoneNumberMasked: phoneNumber ? maskPhoneNumber(phoneNumber) : null,
  };
}
