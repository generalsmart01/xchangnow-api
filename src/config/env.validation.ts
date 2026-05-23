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
});
