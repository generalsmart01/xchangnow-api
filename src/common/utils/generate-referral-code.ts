// src/common/utils/generate-referral-code.ts

/**
 * Generate a user-friendly referral code: `XCN-XXXXXX`
 *
 * Alphabet excludes visually-ambiguous characters (`O / 0 / I / 1 / L`) so
 * users can share codes verbally or over SMS without confusion. With 31
 * characters and 6 positions, there are ~887M unique codes — plenty for the
 * foreseeable future. Collision risk at 100k users is ~0.011%; caller should
 * still handle Prisma's P2002 by retrying generation.
 *
 * Uses `randomBytes` (crypto-grade) rather than Math.random — even though
 * codes aren't secrets, predictable codes invite abuse (someone iterating
 * sequential codes to find unbound referrers).
 */

import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars, no O/0/I/1/L
const CODE_LENGTH = 6;
const PREFIX = 'XCN-';

export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let suffix = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${PREFIX}${suffix}`;
}
