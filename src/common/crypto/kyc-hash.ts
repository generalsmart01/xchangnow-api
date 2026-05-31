// src/common/crypto/kyc-hash.ts

/**
 * Deterministic HMAC-SHA256 hash for uniqueness checks on KYC fields.
 *
 * Why HMAC, not plain SHA256?
 *   BVN is an 11-digit number. There are only 10^11 possible BVNs — a
 *   tiny keyspace by cryptographic standards. A plain SHA256(bvn) is
 *   precomputable in minutes by an attacker: they hash every 11-digit
 *   string and now have a rainbow table mapping hash → BVN.
 *
 *   HMAC-SHA256(bvn, secretKey) defeats this. Without the secret key, an
 *   attacker cannot precompute. Combined with the encrypted column, a DB
 *   leak alone gives the attacker NOTHING — neither the cleartext (key
 *   needed) nor the hash-to-BVN mapping (HMAC key needed).
 *
 * Key management:
 *   - KYC_HASH_KEY env var must be a 32-byte key, base64-encoded
 *   - Same care as KYC_ENCRYPTION_KEY — different value per environment,
 *     never reuse, never commit
 *   - Rotating this key means losing the ability to detect duplicates on
 *     existing rows. Rehash all rows during rotation.
 */

import { createHmac } from 'crypto';

const HASH_ALGORITHM = 'sha256';
const KEY_MIN_LENGTH_BYTES = 32;

function loadKey(): Buffer {
  const raw = process.env.KYC_HASH_KEY;
  if (!raw) {
    throw new Error(
      'KYC_HASH_KEY is not set. KYC operations (BVN/NIN write/lookup) ' +
        'require this env var. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length < KEY_MIN_LENGTH_BYTES) {
    throw new Error(
      `KYC_HASH_KEY must decode to at least ${KEY_MIN_LENGTH_BYTES} bytes ` +
        `(got ${key.length}). Regenerate with crypto.randomBytes(${KEY_MIN_LENGTH_BYTES}).`,
    );
  }
  return key;
}

/**
 * Deterministically hash a KYC value for uniqueness lookups.
 *
 * Same input + same key = same hash. This is what makes "is this BVN already
 * registered?" possible without ever decrypting any rows: hash the incoming
 * BVN, do `SELECT WHERE bvn_hash = ?`. If a match exists, the BVN is taken.
 *
 * Output: 64-char lowercase hex string.
 */
export function hashKyc(plaintext: string): string {
  if (!plaintext) {
    throw new Error('hashKyc: plaintext is empty');
  }
  const key = loadKey();
  return createHmac(HASH_ALGORITHM, key).update(plaintext, 'utf8').digest('hex');
}
