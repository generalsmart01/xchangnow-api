// src/config/env.validation.ts

/**
 * Joi schema validated by @nestjs/config at boot. Anything missing or
 * malformed makes Nest crash IMMEDIATELY with a clear error — better to
 * fail loud at startup than discover at first request that JWT_SECRET is
 * empty.
 *
 * Boot order:
 *   1. ConfigModule.forRoot loads .env into process.env
 *   2. This schema validates the resulting env
 *   3. If invalid → process exits before any controller is registered
 *
 * Conventions:
 *   - Required: anything the API cannot start without (DB URL, JWT secrets)
 *   - Optional with defaults: things with a sensible fallback (port, expiry)
 *   - Optional without defaults: features that "degrade gracefully" if unset
 *     (SMTP — falls back to console; KYC keys — throw only at first BVN write)
 */

import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  // Comma-separated list of allowed frontend origins.
  //   - FIRST entry is the canonical USER-facing frontend — used to build links
  //     inside outgoing emails (verify-email, password reset).
  //   - ALL entries are added to the CORS allowlist in production.
  // Example (dev): http://localhost:3000,http://localhost:3001
  // Example (prod): https://xchangnow.vercel.app,https://xchangnow-management.vercel.app
  // Joi.uri() can't validate a comma-separated string, so this is .string().
  FRONTEND_URL: Joi.string().default('http://localhost:3001'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  BCRYPT_ROUNDS: Joi.number().integer().min(8).max(15).default(12),

  // SMTP — all optional. If unset, EmailService logs to console instead of sending.
  // If any are set, all four (HOST/PORT/USER/PASS) should be set together.
  SMTP_HOST: Joi.string().hostname().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  EMAIL_FROM: Joi.string().optional(),

  // ─── First SUPER_ADMIN bootstrap (Phase 1) ─────────────────────────────
  // Used by prisma/seed.ts to create the very first SUPER_ADMIN on initial
  // deploy. Both optional — if EITHER is unset the seed exits cleanly without
  // crashing (so you can REMOVE these env vars after the first successful
  // deploy and subsequent deploys won't error or overwrite anything).
  //
  // Password rule is stricter than the regular RegisterDto (12+ chars) because
  // admin credentials are higher-value than user credentials.
  SUPER_ADMIN_EMAIL: Joi.string().email().optional(),
  SUPER_ADMIN_PASSWORD: Joi.string().min(12).optional(),

  // ─── HTTP bootstrap endpoint (POST /admin/bootstrap) ───────────────────
  // Alternative path to seed the first SUPER_ADMIN — useful on hosting tiers
  // where you can't run `prisma db seed` (e.g. Render free tier without
  // shell access). The endpoint refuses unless this env var is set AND
  // matches the request body's `secret` (timing-safe compare).
  //
  // Generate with:
  //   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  //
  // Once a SUPER_ADMIN exists, the endpoint refuses regardless. Best
  // practice: REMOVE this env var after the first successful bootstrap so
  // the endpoint becomes a permanent 404.
  BOOTSTRAP_SECRET: Joi.string().min(32).optional(),

  // ─── KYC encryption keys ───────────────────────────────────────────────
  // Required for storing BVN / NIN. Without these, the encrypt/decrypt/hash
  // helpers throw at call time — meaning the app can boot in dev without KYC
  // set up, but the first BVN write will fail loudly with a clear error
  // rather than silently storing a useless empty string.
  //
  // Both keys MUST be 32 bytes (256 bits) of entropy, base64-encoded:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  //
  // Run that command twice — once per key, NEVER reuse. Treat with the same
  // care as JWT secrets:
  //   - never commit to git
  //   - never reuse across dev/staging/production
  //   - rotation requires re-encrypting all bvn_encrypted / nin_encrypted
  //     rows, so plan carefully before changing in production
  KYC_ENCRYPTION_KEY: Joi.string().base64().optional(),
  KYC_HASH_KEY: Joi.string().base64().optional(),
});
