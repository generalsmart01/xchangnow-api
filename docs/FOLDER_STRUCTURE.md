# XchangNow API — Folder Structure

Annotated map of the codebase. Anchored on `src/`. Use this when you need
to find where something lives or where a new feature should slot in.

## Top-level

```
xchangnow-api/
├── prisma/                # Database schema + seed + migrations
│   ├── schema.prisma      # All models, enums, relations (single source of truth)
│   └── seed.ts            # SUPER_ADMIN bootstrap + backfills (idempotent)
├── src/                   # All application code (see below)
├── docs/                  # Markdown reference docs (this file lives here)
├── docker-compose.yml     # Local Postgres for development
├── package.json           # Dependencies + npm scripts + Prisma config
├── tsconfig.json          # TypeScript compiler config
└── .env                   # Local environment variables (NEVER commit)
```

## `src/` — the running application

```
src/
├── main.ts                # Bootstrap — creates the Nest app, wires global
│                          # pipes/filters/interceptors, starts the HTTP listener,
│                          # configures Swagger at /docs
├── app.module.ts          # Root module — composes every feature module
│
├── common/                # Cross-cutting infrastructure shared by feature modules
├── config/                # Env var validation (Joi schema)
├── database/              # Prisma client + module (@Global)
├── integrations/          # Adapters for external services
└── modules/               # Feature modules — one per domain concern
```

## `src/common/` — cross-cutting infrastructure

```
src/common/
├── crypto/                # Cryptographic primitives for KYC at-rest storage
│   ├── kyc-encryption.ts  # AES-256-GCM encrypt/decrypt (BVN, NIN, ...)
│   └── kyc-hash.ts        # HMAC-SHA256 deterministic hash (for uniqueness on
│                          # encrypted values without decryption)
│
├── decorators/            # Metadata decorators consumed by interceptors/guards
│   └── log-message.decorator.ts   # @LogMessage('...') → terminal log label
│
├── filters/               # Global exception → JSON converters
│   └── all-exceptions.filter.ts   # The error-envelope shape
│                                  # ({success:false, error:{code, details}, meta})
│
├── interceptors/          # Cross-cutting request/response handlers
│   ├── http-logging.interceptor.ts   # Mints requestId, logs entry+exit
│   └── response.interceptor.ts       # Wraps success responses in the envelope
│
├── pii/                   # PII access audit
│   ├── pii-access-log.service.ts     # log() helper called by services on
│   │                                 # admin-side PII reads/writes
│   └── pii.module.ts                 # @Global so it's injectable everywhere
│
├── utils/                 # Shared pure functions (no DI, no DB)
│   ├── compute-referral-commission.ts # 0.1% commission calculator
│   ├── flatten-user.ts                # User + Profile → flat API shape
│   ├── generate-referral-code.ts      # XCN-XXXXXX code generator
│   ├── mask-pii.ts                    # phoneNumberMasked, accountNumberMasked,
│   │                                  # flattenUserMasked (for admin responses)
│   ├── normalize-email.ts             # lowercase + trim
│   └── normalize-phone.ts             # libphonenumber-js → E.164 (NG-only)
│
└── validators/            # Custom class-validator decorators
    ├── is-nigerian-id.decorator.ts    # @IsBvn() + @IsNin() (11-digit format)
    └── is-phone-number-e164.decorator.ts  # @IsPhoneNumberE164() (NG-only)
```

## `src/config/`

```
src/config/
└── env.validation.ts      # Joi schema validated at boot. NODE_ENV, PORT,
                           # DATABASE_URL, JWT_*, BCRYPT_ROUNDS, SMTP_*,
                           # FRONTEND_URL, SUPER_ADMIN_EMAIL/PASSWORD,
                           # KYC_ENCRYPTION_KEY, KYC_HASH_KEY
```

## `src/database/`

```
src/database/
├── prisma.service.ts      # Extends PrismaClient with onModuleInit ($connect)
│                          # and onModuleDestroy ($disconnect)
└── prisma.module.ts       # @Global — PrismaService injectable everywhere
```

## `src/integrations/` — external services

```
src/integrations/
├── email/
│   ├── email.service.ts   # Nodemailer wrapper. sendVerificationEmail,
│   │                      # sendPasswordResetEmail, sendInviteEmail.
│   │                      # Falls back to console-log when SMTP unset.
│   └── email.module.ts
└── ip-intel/
    ├── ip-intel.service.ts # IP reputation provider integration (VPN/proxy/
    │                       # Tor detection). Used by SecurityModule's risk
    │                       # gate at login.
    └── ip-intel.module.ts
```

## `src/modules/` — feature modules

Each module owns one domain. Module pattern:

```
modules/<name>/
├── <name>.module.ts       # Wires controller + service + imports
├── <name>.controller.ts   # HTTP layer — guards, Swagger, log labels
├── <name>.service.ts      # Business logic
└── dto/                   # Request DTOs (class-validator + Swagger)
    ├── *.dto.ts
    └── ...
```

Some modules add extra files (strategies, decorators, guards). Anything
auth-related stays under `auth/` for discoverability.

```
src/modules/
│
├── admin/                 # Operational endpoints not owned by other modules
│   ├── admin.controller.ts        # /admin/ping (auth-chain smoke test)
│   ├── staff.controller.ts        # /admin/staff/* (invite, list, role change)
│   ├── staff.service.ts           # Invitation flow (sends invite email,
│   │                              # issues InviteToken via AuthService)
│   ├── admin.module.ts
│   └── dto/
│       ├── create-staff.dto.ts
│       ├── list-staff-query.dto.ts
│       └── update-staff-role.dto.ts
│
├── auth/                  # Authentication + session lifecycle
│   ├── auth.controller.ts         # /auth/* (register, login, refresh, logout,
│   │                              # verify-email, resend-verification,
│   │                              # forgot-password, reset-password,
│   │                              # accept-invite, me)
│   ├── auth.service.ts            # All auth business logic
│   ├── auth.module.ts
│   ├── decorators/                # @CurrentUser, @Roles, @RequireVerified,
│   │                              # @RequireKycApproved
│   ├── dto/                       # 8 DTOs (one per write endpoint)
│   ├── enums/role.enum.ts         # Re-exports UserRole from @prisma/client
│   ├── guards/                    # JwtAuthGuard, RolesGuard, VerifiedGuard,
│   │                              # KycApprovedGuard
│   ├── interfaces/                # JwtPayload, AuthenticatedUser
│   └── strategies/jwt.strategy.ts # Passport JWT strategy
│
├── health/                # Process liveness check
│   ├── health.controller.ts       # /health
│   ├── health.service.ts          # status + uptime; intentionally no DB hit
│   └── health.module.ts
│
├── kyc/                   # Manual KYC verification (BVN/NIN + selfie)
│   ├── kyc.controller.ts          # /kyc/me, /kyc, /kyc/:userId,
│   │                              # /kyc/:userId/approve, /kyc/:userId/reject
│   ├── kyc.service.ts             # Encrypts BVN/NIN, manages review queue,
│   │                              # writes PiiAccessLog (KYC_DOCUMENT READ on
│   │                              # admin decryption)
│   ├── kyc.module.ts
│   └── dto/
│       ├── submit-kyc.dto.ts
│       ├── reject-kyc.dto.ts
│       └── list-kyc-query.dto.ts
│
├── payouts/               # Payout state machine (SELL only)
│   ├── payouts.controller.ts      # /payouts/* (self read + admin status update)
│   ├── payouts.service.ts         # PENDING → PROCESSING → PAID state machine.
│   │                              # On PAID: cascades Transaction → COMPLETED
│   │                              # AND credits referral commission, atomically.
│   ├── payouts.module.ts
│   └── dto/
│       ├── update-payout-status.dto.ts
│       └── list-payouts-query.dto.ts
│
├── rates/                 # Time-series exchange rate snapshots
│   ├── rates.controller.ts        # /rates/* (current + admin CRUD)
│   ├── rates.service.ts           # Append-only — POST creates new snapshot
│   ├── rates.module.ts
│   └── dto/
│       ├── create-rate.dto.ts
│       ├── update-rate.dto.ts
│       └── list-rates-query.dto.ts
│
├── referrals/             # Referral graph + 0.1% commission ledger
│   ├── referrals.controller.ts    # /referrals/me, /referrals/me/referees,
│   │                              # /referrals/me/earnings (all JWT-gated reads)
│   ├── referrals.service.ts       # Read-only; commission writes happen in
│   │                              # transactions/payouts on COMPLETED
│   ├── referrals.module.ts
│   └── dto/list-referrals-query.dto.ts
│
├── security/              # Pre-auth risk evaluation
│   ├── security.service.ts        # Login risk gate consulted by AuthService
│   │                              # BEFORE the bcrypt compare
│   ├── risk.service.ts            # Pure scoring function (IP intel + recent
│   │                              # failed attempts → severity)
│   └── security.module.ts
│
├── transactions/          # BUY/SELL/SWAP lifecycle (state machine)
│   ├── transactions.controller.ts # /transactions/* (customer create/read +
│   │                              # admin approve/reject/mark-completed)
│   ├── transactions.service.ts    # All transaction business logic. On BUY/SWAP
│   │                              # markCompleted: credits referral commission
│   │                              # atomically with the status flip.
│   ├── transactions.module.ts
│   └── dto/                       # 8 DTOs for create/proof/approve/reject/etc
│
├── users/                 # User + Profile + BankAccount surface
│   ├── users.controller.ts        # /users/* (self + admin CRUD, anonymize)
│   ├── users.service.ts           # Profile updates, bank account CRUD,
│   │                              # admin reads (writes PiiAccessLog), status
│   │                              # changes
│   ├── anonymization.service.ts   # Right-to-be-forgotten. Atomic scrub across
│   │                              # User+Profile+BankAccount with session
│   │                              # revocation + token deletion + audit writes.
│   ├── users.module.ts
│   └── dto/
│       ├── update-user.dto.ts
│       ├── create-bank-account.dto.ts
│       ├── update-bank-account.dto.ts
│       ├── list-users-query.dto.ts
│       ├── admin-update-user-status.dto.ts
│       └── anonymize-user.dto.ts
│
└── wallets/               # Company-owned crypto wallet addresses
    ├── wallets.controller.ts      # /wallets/* (admin CRUD)
    ├── wallets.service.ts         # pickActiveWallet() consumed by TransactionsService
    ├── wallets.module.ts
    └── dto/
        ├── create-wallet.dto.ts
        ├── update-wallet.dto.ts
        └── list-wallets-query.dto.ts
```

## Architectural rules baked into this layout

**Module boundaries.** Each feature module owns its controller + service + DTOs.
Cross-module calls happen ONLY through exported services (see each
module's `exports` array). Direct DB writes across modules are avoided
except in one documented case: `PayoutsService.updateStatus` writes
`Transaction.status` directly on PAID — done this way to prevent a
circular dependency between PayoutsModule and TransactionsModule.

**Pure helpers vs services.** Anything that doesn't need DI or DB lives
under `src/common/utils/` as a pure function (testable in isolation).
Services own the IO; utils own the logic.

**Audit lives at the trigger point.** Commission credits happen inside
the same `prisma.$transaction` as the status flip that triggered them
(see `TransactionsService.markCompleted` and `PayoutsService.updateStatus`).
PII access logs happen at the read site, not a global interceptor. This
keeps atomicity visible at the call site.

**Comment + docstring policy.** Every file starts with:

```ts
// src/path/to/file.ts

/**
 * Module overview — what is this file, what does it own, what doesn't it.
 * Multi-line JSDoc.
 */

import { ... } from '...';
```

See any controller or service for the pattern.

## Adding a new feature module

1. `mkdir src/modules/<name>` + `src/modules/<name>/dto`
2. Create `<name>.module.ts` (Module decorator wiring)
3. Create `<name>.service.ts` (business logic)
4. Create `<name>.controller.ts` (HTTP + Swagger + log labels)
5. Add DTOs under `dto/`
6. Register in `src/app.module.ts`
7. Document in this file (this section) — add the tree entry

## Adding a new endpoint to an existing module

1. Add the route handler to `<name>.controller.ts` with full Swagger:
   - `@ApiOperation({summary, description})`
   - `@ApiResponse` for every status code returned
   - `@LogMessage(...)` for the terminal log label
2. Implement the business logic in `<name>.service.ts`
3. Add a JSDoc block above the new service method describing side effects
4. Update the endpoint summary block at the top of the controller file
5. Update `docs/API_REFERENCE.md` (this file's sibling)
