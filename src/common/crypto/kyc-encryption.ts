// src/common/crypto/kyc-encryption.ts

/**
 * AES-256-GCM for reversible storage of KYC fields (BVN, NIN, future
 * passport numbers, etc.). GCM is the right choice here — it provides both
 * confidentiality (encryption) AND integrity (auth tag rejects tampered
 * ciphertexts) in one operation.
 *
 * Wire format (single string):
 *   base64url( iv (12 bytes) || authTag (16 bytes) || ciphertext (N bytes) )
 *
 * Why concatenated into one column?
 *   - One DB column instead of three (iv, tag, ciphertext)
 *   - Easy to migrate between fields without breaking older rows
 *
 * Key management:
 *   - KYC_ENCRYPTION_KEY env var must be a 32-byte (256-bit) key, base64-encoded
 *   - Single key for dev/staging. Production-grade deployments should layer
 *     envelope encryption with a KMS — but that's a future upgrade.
 *   - Key rotation: if you change KYC_ENCRYPTION_KEY, every existing encrypted
 *     row becomes undecryptable. To rotate, decrypt-then-reencrypt all rows
 *     during the rotation (the encrypted-at-rest version of a password reset).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // GCM standard
const AUTH_TAG_LENGTH_BYTES = 16; // GCM standard
const KEY_LENGTH_BYTES = 32; // AES-256

/**
 * Loads the key from env once, validates it. Throws if missing or wrong size
 * — better to fail loudly at first call than silently encrypt with a bad key.
 */
function loadKey(): Buffer {
  const raw = process.env.KYC_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'KYC_ENCRYPTION_KEY is not set. KYC operations (BVN/NIN write/read) ' +
        'require this env var. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `KYC_ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes ` +
        `(got ${key.length}). Regenerate with crypto.randomBytes(${KEY_LENGTH_BYTES}).`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext KYC value (BVN, NIN, etc.) for at-rest storage.
 * Output is a single base64url string safe to store in a DB column.
 *
 * Note: GCM is non-deterministic by design — encrypting the same plaintext
 * twice yields different ciphertexts. That's why we keep a separate `*Hash`
 * column for uniqueness checks (see kyc-hash.ts).
 */
export function encryptKyc(plaintext: string): string {
  if (!plaintext) {
    throw new Error('encryptKyc: plaintext is empty');
  }
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  // [iv || authTag || ciphertext] as a single base64url string
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

/**
 * Decrypt a value previously produced by encryptKyc. Throws if the ciphertext
 * was tampered with (GCM auth tag mismatch) or if the key has changed since
 * encryption.
 *
 * Callers should ALWAYS log a PiiAccessLog row (action='READ',
 * resourceType='KYC_DOCUMENT') before invoking this — decryption is one of
 * the most audit-worthy operations in the system.
 */
export function decryptKyc(ciphertextB64Url: string): string {
  if (!ciphertextB64Url) {
    throw new Error('decryptKyc: input is empty');
  }
  const buf = Buffer.from(ciphertextB64Url, 'base64url');
  if (buf.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error('decryptKyc: ciphertext is too short to be valid');
  }

  const iv = buf.subarray(0, IV_LENGTH_BYTES);
  const authTag = buf.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = buf.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
