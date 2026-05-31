# XchangNow API — Reference

Complete endpoint reference. Pair this with the live Swagger UI at `/docs`
for interactive try-it-out.

**Base URL**
- Local: `http://localhost:3450/api`
- Render staging: `https://your-render-url/api`
- Production (Contabo): `https://api.xchangnow.com/api` (when live)

## Conventions

- **Money + crypto amounts are STRINGS** (`"0.005"`, not `0.005`) — preserves
  precision past `Number.MAX_SAFE_INTEGER`.
- **All IDs are CUIDs** — opaque strings like `cmpgx5qjh0000o85kzmyj8zpy`.
- **Pagination** is 1-indexed: `page=1, pageSize=20`. Max `pageSize` = 100.
- **Soft-deleted** users (`deletedAt` set) are excluded from non-admin lists.
- **404 = "not found OR not yours"** — same response either way; don't leak existence.

## Auth markers

| | |
|---|---|
| 🔓 | Public — no auth |
| 🔒 | JWT in `Authorization: Bearer <accessToken>` |
| ✅ | JWT + `isEmailVerified=true` (else 403) |
| 👮 | JWT + role in `{ADMIN, SUPER_ADMIN}` (or as noted per route) |
| 🛡️ | JWT + KYC `APPROVED` (else 403) — only applied when `@RequireKycApproved` is on the route. Currently NOT applied anywhere; lever to flip on. |

## Response envelope

Every response — success or error — wraps the payload in this shape so the
FE has ONE response parser branching only on `success`.

### Success

```json
{
  "success": true,
  "message": "User registered",
  "data": { /* endpoint-specific payload */ },
  "meta": {
    "requestId": "28516a54-142e-49e5-98f2-c3044ba1697b",
    "timestamp": "2026-05-28T14:30:00.000Z",
    "durationMs": 142,
    "path": "/api/auth/register"
  }
}
```

### Error

```json
{
  "success": false,
  "message": "Phone number already registered",
  "data": null,
  "error": {
    "code": "CONFLICT",
    "details": ["Phone number already registered"]
  },
  "meta": {
    "requestId": "ab12cd34-5678-90ef-1234-567890abcdef",
    "timestamp": "2026-05-28T14:30:00.000Z",
    "path": "/api/auth/register"
  }
}
```

### Error codes (semantic — switch on these in the FE)

| HTTP status | `error.code` |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 429 | `RATE_LIMITED` |
| 500+ | `INTERNAL_SERVER_ERROR` |

Below, only the `data` field is shown per endpoint — envelope wrapping is
implicit. Errors are summarized in tables at the bottom of each endpoint.

---

# 1. AUTH — `/auth/*`

## 🔓 POST `/auth/register`

Create a new USER account. NO tokens issued (strict gate — must verify email
then call `/auth/login`). Verification email sent.

**Body** — `RegisterDto`:
```json
{
  "email": "michael@example.com",
  "password": "StrongP@ss1",
  "firstName": "Michael",
  "lastName": "Adeleke",
  "phoneNumber": "08012345678",
  "referralCode": "XCN-A8K2P9"
}
```

| Field | Required | Validation |
|---|---|---|
| `email` | ✓ | RFC email, max 254 |
| `password` | ✓ | 8-128, must have UPPER + lower + digit |
| `firstName` | ✓ | 1-60 chars |
| `lastName` | ✓ | 1-60 chars |
| `phoneNumber` | — | NG-only (accepts `0801…`, `+234…`, etc.) |
| `referralCode` | — | Existing user's code. Unknown → 400. |

**201 data**:
```json
{
  "user": {
    "id": "cmpgx5qjh0000o85kzmyj8zpy",
    "email": "michael@example.com",
    "firstName": "Michael",
    "lastName": "Adeleke",
    "phoneNumber": "08012345678",
    "role": "USER",
    "status": "PENDING_VERIFICATION",
    "isEmailVerified": false,
    "lastLoginAt": null,
    "lastLoginIp": null,
    "createdAt": "2026-05-28T14:30:00.000Z",
    "updatedAt": "2026-05-28T14:30:00.000Z",
    "deletedAt": null
  },
  "verifyToken": "a1b2c3d4..."
}
```
> `verifyToken` only present in dev (`NODE_ENV != production`).

**Errors**

| Status | Message |
|---|---|
| 400 | Validation errors (`details[]` per field) OR `"Unknown referral code: ..."` |
| 409 | `"Email already registered"` / `"Phone number already registered"` |

---

## 🔓 POST `/auth/login`

Authenticate. Strict gate — only `ACTIVE` users may log in.

**Body** — `LoginDto`:
```json
{ "email": "michael@example.com", "password": "StrongP@ss1" }
```

**200 data**:
```json
{
  "user": { /* same shape as register's user */ },
  "tokens": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eEt8r2Vh3LkPq9aBxNm...",
    "accessExpiresIn": "15m",
    "refreshExpiresIn": "7d"
  }
}
```

**Errors** (all 401, branch on `message`)

| Message | What FE does |
|---|---|
| `"Email or password incorrect"` | Show "wrong credentials" |
| `"Please verify your email before logging in. ..."` | Show "Resend verification" CTA |
| `"Account not active"` | "Account suspended — contact support" |
| `"Too many failed attempts. Try again later."` | Rate-limit countdown |

---

## 🔓 POST `/auth/refresh`

Rotate the refresh + access tokens. Old refresh token is revoked atomically.

**Body** — `RefreshTokenDto`:
```json
{ "refreshToken": "eEt8r2Vh3LkPq9aBxNm..." }
```

**200 data**:
```json
{
  "tokens": {
    "accessToken": "...",
    "refreshToken": "...",
    "accessExpiresIn": "15m",
    "refreshExpiresIn": "7d"
  }
}
```

**Errors**: `401` invalid / revoked / expired refresh token.

---

## 🔒 POST `/auth/logout`

Revokes the current session only. Other sessions on other devices unaffected.

**Body**: none.

**204** — empty body.

---

## 🔒 GET `/auth/me`

Lightweight identity from the JWT.

**200 data**:
```json
{
  "id": "cmpgx5qjh0000o85kzmyj8zpy",
  "email": "michael@example.com",
  "role": "USER",
  "sessionId": "cmpg9k3lk0009o84wjn521kk4"
}
```

For full profile use `GET /users/me`.

---

## 🔓 POST `/auth/verify-email`

Consume the email link's token. On success: user → `ACTIVE`,
`isEmailVerified = true`, all outstanding verification tokens for this user
are deleted.

**Body** — `VerifyEmailDto`:
```json
{ "token": "a1b2c3d4..." }
```

**200 data**:
```json
{ "message": "Email verified" }
```

**Errors**: `400` token invalid / expired.

---

## 🔓 POST `/auth/resend-verification`

Generic response — never reveals if account exists.

**Body** — `ResendVerificationDto`:
```json
{ "email": "michael@example.com" }
```

**200 data**:
```json
{ "message": "If the account exists and is unverified, a new email has been sent" }
```

---

## 🔓 POST `/auth/forgot-password`

**Body** — `ForgotPasswordDto`:
```json
{ "email": "michael@example.com" }
```

**200 data**:
```json
{
  "message": "If an account exists for that email, a reset link has been sent",
  "resetToken": "a1b2c3d4..."
}
```
> `resetToken` only present in dev.

---

## 🔓 POST `/auth/reset-password`

Atomic: sets new password, marks token used, **revokes ALL active sessions**,
writes `PASSWORD_RESET` security log.

**Body** — `ResetPasswordDto`:
```json
{ "token": "a1b2c3d4...", "newPassword": "NewStrongP@ss2" }
```

**200 data**:
```json
{ "message": "Password reset successful. Please log in with your new password." }
```

**Errors**: `400` token invalid / used / expired (>1h).

---

## 🔓 POST `/auth/accept-invite`

Called by an invited staff member from the FE `/accept-invite` page.
Atomic: sets password, status → `ACTIVE`, `isEmailVerified = true`, marks
invite token used, writes security_log.

**Body** — `AcceptInviteDto`:
```json
{ "token": "a1b2c3d4...", "password": "StaffP@ss1!" }
```

**200 data**:
```json
{ "message": "Invite accepted. Your account is active — please log in with your new password." }
```

**Errors**: `400` token invalid / used / expired.

---

# 2. USERS — `/users/*`

## 🔒 GET `/users/me`

Full self-profile.

**200 data**: same shape as register's user (all fields, no `passwordHash`).

---

## 🔒 PATCH `/users/me`

All fields optional. Omit to leave unchanged. `phoneNumber: ""` clears
phone (both raw and normalized null'd).

**Body** — `UpdateUserDto`:
```json
{
  "firstName": "Michael",
  "lastName": "Adeleke",
  "phoneNumber": "08012345678"
}
```

**200 data**: updated user.

**Errors**: `409` phone collides with another user's normalized form.

---

## 🔒 GET `/users/me/bank-accounts`

Default-first, then oldest first.

**200 data**:
```json
[
  {
    "id": "cmpg...",
    "userId": "cmpg...",
    "bankName": "Guaranty Trust Bank",
    "accountNumber": "0123456789",
    "accountName": "Michael Adeleke",
    "isDefault": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

---

## 🔒 POST `/users/me/bank-accounts`

If `isDefault=true`, previously-default account is auto-unset atomically.

**Body** — `CreateBankAccountDto`:
```json
{
  "bankName": "Guaranty Trust Bank",
  "accountNumber": "0123456789",
  "accountName": "Michael Adeleke",
  "isDefault": true
}
```

**201 data**: new bank account.

**Errors**: `409` duplicate `(userId, bankName, accountNumber)`.

---

## 🔒 PATCH `/users/me/bank-accounts/:id`

All fields optional. Setting `isDefault=true` reassigns atomically.

**200 data**: updated bank account.

**Errors**: `404` not found / not yours.

---

## 🔒 DELETE `/users/me/bank-accounts/:id`

Hard delete. Refused if any payouts reference it.

**204** — empty body.

**Errors**: `404` not found · `409` has payouts attached.

---

## 👮 GET `/users` (ADMIN, SUPER_ADMIN)

Paginated user list. Soft-deleted users excluded. **Returns masked phone**.

**Query**: `page`, `pageSize`, `status` enum, `search` (substring on email/firstName/lastName).

**200 data**:
```json
{
  "users": [
    {
      "id": "cmpg...",
      "email": "michael@example.com",
      "firstName": "Michael",
      "lastName": "Adeleke",
      "phoneNumberMasked": "+234***5678",
      "role": "USER",
      "status": "ACTIVE",
      ...
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

Side effects: PiiAccessLog `PROFILE LIST`.

---

## 👮 GET `/users/:id` (ADMIN, SUPER_ADMIN)

Includes soft-deleted users. **Returns masked phone**.

**200 data**: user with `phoneNumberMasked` (same shape as list rows).

**Errors**: `404` not found.

Side effects: PiiAccessLog `PROFILE READ` (target user ID).

---

## 👮 PATCH `/users/:id/status` (ADMIN, SUPER_ADMIN)

**Body** — `AdminUpdateUserStatusDto`:
```json
{ "status": "SUSPENDED", "reason": "Account flagged for KYC review" }
```

**200 data**: updated user (masked).

**Errors**: `403` self-deactivation · `404` user not found.

Side effects: user_activity_log (`STATUS_CHANGED`) + PiiAccessLog (`USER UPDATE`).

---

## 👮 POST `/users/:id/anonymize` (ADMIN, SUPER_ADMIN)

**Right-to-be-forgotten flow.** Atomic scrub across User + Profile + BankAccount,
revokes all sessions, deletes outstanding tokens, writes HIGH-severity
security_log + admin_log + pii_access_log. Transactions, payouts, and audit
logs are preserved.

**Body** — `AnonymizeUserDto`:
```json
{
  "confirmEmail": "michael@example.com",
  "reason": "User requested account deletion under NDPR Article 26"
}
```

`confirmEmail` MUST match the target user's current email (case-insensitive).

**200 data**:
```json
{
  "message": "User anonymized",
  "anonymizedAt": "2026-05-28T14:30:00.000Z"
}
```

**Errors**

| Status | When |
|---|---|
| 403 | self-anonymization / SUPER_ADMIN target / `confirmEmail` mismatch |
| 404 | user not found |
| 409 | already anonymized |

---

# 3. KYC — `/kyc/*`

Manual review only. No external provider integration yet.

## 🔒 POST `/kyc/me`

User submits BVN + NIN (at least one) + selfie URL.

**Body** — `SubmitKycDto`:
```json
{
  "bvn": "12345678901",
  "nin": "12345678901",
  "selfieUrl": "https://res.cloudinary.com/xchangnow/image/upload/.../selfie.jpg"
}
```

| Field | Required | Validation |
|---|---|---|
| `bvn` | one-of | exactly 11 digits |
| `nin` | one-of | exactly 11 digits |
| `selfieUrl` | ✓ | HTTPS URL, max 500 chars |

**201 data** (`KycSelfView`):
```json
{
  "status": "PENDING",
  "submittedAt": "2026-05-28T14:30:00.000Z",
  "reviewedAt": null,
  "rejectionReason": null,
  "selfieUrl": "https://...",
  "hasBvn": true,
  "hasNin": false
}
```

**Errors**

| Status | When |
|---|---|
| 400 | `"At least one of bvn or nin is required"` |
| 409 | BVN/NIN already used by another account OR KYC already approved |

Side effects: PiiAccessLog `KYC_DOCUMENT CREATE`.

---

## 🔒 GET `/kyc/me`

User views own status. Does NOT decrypt BVN/NIN.

**200 data**: same `KycSelfView` shape as submit.

---

## 👮 GET `/kyc` (ADMIN, SUPER_ADMIN)

Review queue. Default sort: oldest first within the filter.

**Query**: `page`, `pageSize`, `status` (`NONE` | `PENDING` | `APPROVED` | `REJECTED`).

**200 data**:
```json
{
  "submissions": [
    {
      "userId": "cmpg...",
      "email": "user@example.com",
      "firstName": "Tunde",
      "lastName": "Bello",
      "status": "PENDING",
      "submittedAt": "2026-05-28T13:00:00.000Z",
      "reviewedAt": null,
      "hasBvn": true,
      "hasNin": false
    }
  ],
  "total": 8,
  "page": 1,
  "pageSize": 20
}
```

Side effects: PiiAccessLog `KYC_DOCUMENT LIST`.

---

## 👮 GET `/kyc/:userId` (ADMIN, SUPER_ADMIN)

**DECRYPTS BVN/NIN** to plaintext for the admin review screen.
Most audit-worthy operation in the system.

**200 data** (`KycAdminFullView`):
```json
{
  "userId": "cmpg...",
  "email": "user@example.com",
  "firstName": "Tunde",
  "lastName": "Bello",
  "status": "PENDING",
  "submittedAt": "2026-05-28T13:00:00.000Z",
  "reviewedAt": null,
  "reviewedById": null,
  "hasBvn": true,
  "hasNin": false,
  "bvn": "12345678901",
  "nin": null,
  "selfieUrl": "https://...",
  "rejectionReason": null
}
```

**Errors**: `404` profile not found.

Side effects: PiiAccessLog `KYC_DOCUMENT READ` with `reason: "Admin KYC review"`.

---

## 👮 POST `/kyc/:userId/approve` (ADMIN, SUPER_ADMIN)

**Body**: none.

**200 data**: `KycSelfView` with status `APPROVED`.

**Errors**: `400` not in PENDING · `403` self-approval.

Side effects: admin_log + security_log (MEDIUM) + PiiAccessLog (`KYC_DOCUMENT UPDATE`).

---

## 👮 POST `/kyc/:userId/reject` (ADMIN, SUPER_ADMIN)

**Body** — `RejectKycDto`:
```json
{ "reason": "Selfie is too blurry. Please retake in better lighting." }
```

**200 data**: `KycSelfView` with status `REJECTED`, `rejectionReason` set.

**Errors**: `400` not in PENDING · `403` self-rejection.

User can resubmit (flips back to PENDING).

---

# 4. TRANSACTIONS — `/transactions/*`

State machine:
```
SELL/SWAP: PENDING ──► UNDER_REVIEW ──► APPROVED ──► COMPLETED
BUY:       AWAITING_PAYMENT ──► UNDER_REVIEW ──► APPROVED ──► COMPLETED
                              └─► REJECTED (with rejectedReason)
```

## ✅ POST `/transactions/sell`

Customer sells crypto → gets NGN payout to default bank.

**Preconditions**: verified email + has a default bank account + active company wallet exists for the chosen `assetNetworkId` pair.

**Body** — `CreateSellDto`:
```json
{
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "cryptoAmount": "0.005"
}
```

`assetNetworkId` is a single FK to an `AssetNetwork` row (the asset × network pair from `GET /assets`). One FK guarantees the combination is valid — you can't reference a coin on a chain that doesn't support it.

**201 data**:
```json
{
  "id": "cmpg...",
  "referenceCode": "XCN-A55A2689",
  "type": "SELL",
  "status": "PENDING",
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "cryptoAmount": "0.005",
  "toAssetNetworkId": null,
  "fiatAmount": "290000.00",
  "fiatCurrency": "NGN",
  "rate": "58000000.00",
  "walletAddressId": "cmpg...",
  "expiresAt": "2026-05-28T15:00:00.000Z",
  "assetNetwork": {
    "id": "cmpqe002b0001o81g8k7vmpqr",
    "asset": { "id": "cmpqd99zz0000o81g4kq8jz5x", "symbol": "BTC", "name": "Bitcoin", "decimals": 8 },
    "network": { "id": "cmpqd001a0000o81g4kq8jz5x", "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
  },
  "toAssetNetwork": null,
  "walletAddress": {
    "id": "cmpg...",
    "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
    "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
  }
}
```

Every transaction response embeds the full `assetNetwork` chain — frontend gets asset symbol/decimals + network code/chainId without a separate fetch.

**Errors**: `400` no default bank / no active wallet / disabled pair · `403` email not verified · `503` no recent rate for this asset (admin must POST a rate snapshot first).

---

## ✅ POST `/transactions/buy`

Customer pays NGN bank transfer → gets crypto sent by admin.

**Body** — `CreateBuyDto`:
```json
{
  "assetNetworkId": "cmpqe003c0002o81g4abcdef",
  "fiatAmount": "30000.00"
}
```

**201 data**:
```json
{
  "id": "cmpg...",
  "referenceCode": "XCN-7503C7E4",
  "type": "BUY",
  "status": "AWAITING_PAYMENT",
  "assetNetworkId": "cmpqe003c0002o81g4abcdef",
  "cryptoAmount": "20.000000000000000000",
  "fiatAmount": "30000.00",
  "rate": "1500.00",
  "assetNetwork": {
    "id": "cmpqe003c0002o81g4abcdef",
    "asset": { "symbol": "USDT", "name": "Tether USD", "decimals": 6 },
    "network": { "code": "TRON", "name": "Tron", "chainId": null }
  },
  "paymentInstructions": {
    "bankName": "Wema Bank",
    "accountNumber": "0123456789",
    "accountName": "XchangNow Ltd",
    "reference": "XCN-7503C7E4"
  }
}
```

**Errors**: `400` invalid/disabled assetNetworkId · `403` email not verified · `503` no recent rate for this asset.

---

## ✅ POST `/transactions/swap`

Crypto-to-crypto. User sends FROM-asset to our company wallet; we send
TO-asset to their `toAddress` after admin approval.

**Body** — `CreateSwapDto`:
```json
{
  "fromAssetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "fromAmount": "0.005",
  "toAssetNetworkId": "cmpqe003c0002o81g4abcdef",
  "toAddress": "TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt"
}
```

`fromAssetNetworkId` and `toAssetNetworkId` MUST reference different **assets** — same-asset cross-network bridging (e.g. USDT-ETH ↔ USDT-TRON) is rejected as 400. Bridging will be a separate future feature.

**201 data**: transaction with `toAmount` computed via pair rate
(`fromSell / toBuy`), `fiatAmount` and `fiatCurrency` both `null` (no fiat
side on SWAP). Both `assetNetwork` and `toAssetNetwork` are embedded in the response.

**Errors**: `400` same pair / same asset (bridging) / no active wallet for FROM pair · `403` email not verified · `503` no recent rate.

---

## 🔒 GET `/transactions/me`

Paginated, scoped to caller.

**Query**: `page`, `pageSize`, `status`, `type`, `assetId`, `assetNetworkId`.

`assetId` filters by the primary asset across all its networks. `assetNetworkId` filters by an exact pair (more specific). Pass either, not both.

**200 data**: `{ transactions: [...], total, page, pageSize }` — each transaction includes embedded `assetNetwork` (and `toAssetNetwork` for SWAPs).

---

## 🔒 GET `/transactions/me/:id`

Single transaction with `proofs[]`, `walletAddress`. BUY includes
`paymentInstructions`.

**200 data**: transaction (full shape).

**Errors**: `404` not found / not yours.

---

## ✅ POST `/transactions/me/:id/proof`

Records proof + atomically advances tx → `UNDER_REVIEW`. For SELL/SWAP,
the hash also lands on `transaction.txHash` (anti-replay; @unique).

**Body** — `UploadProofDto`:
```json
{
  "type": "CRYPTO_TX_HASH",
  "value": "a1b2c3d4e5f6...",
  "notes": "Sent at 02:30 GMT, 3 confirmations"
}
```

| Transaction type | Required proof type |
|---|---|
| SELL | `CRYPTO_TX_HASH` |
| SWAP | `CRYPTO_TX_HASH` |
| BUY | `BANK_TRANSFER_RECEIPT` (`value` is the receipt URL) |

**201 data**:
```json
{
  "id": "cmpg...",
  "transactionId": "cmpg...",
  "type": "CRYPTO_TX_HASH",
  "url": "a1b2c3d4...",
  "notes": null,
  "uploadedAt": "2026-05-28T14:35:00.000Z"
}
```

**Errors**

| Status | When |
|---|---|
| 400 | wrong proof type for tx type / tx not in PENDING or AWAITING_PAYMENT |
| 403 | email not verified |
| 404 | tx not found / not yours |
| 409 | duplicate tx hash (anti-replay system-wide) |

---

## 👮 GET `/transactions` (ADMIN, SUPER_ADMIN)

Cross-user listing. Same query as `/me` + `userId`.

**200 data**: same paginated shape.

---

## 👮 GET `/transactions/:id` (ADMIN, SUPER_ADMIN)

Full record with `proofs[]`, `walletAddress`, and the `user` (id/email/name).

---

## 👮 POST `/transactions/:id/approve` (ADMIN, SUPER_ADMIN)

`UNDER_REVIEW → APPROVED`. For SELL: also creates a PENDING Payout
targeting the user's current default bank, atomically.

**Body** — `ApproveTransactionDto`:
```json
{ "notes": "Tx hash verified on Blockstream" }
```

**200 data**: updated transaction (with `approvedById`, `approvedAt`).

**Errors**: `400` not in UNDER_REVIEW or SELL user no longer has default bank.

---

## 👮 POST `/transactions/:id/reject` (ADMIN, SUPER_ADMIN)

→ `REJECTED` with `rejectedReason`. Allowed sources: PENDING / AWAITING_PAYMENT / UNDER_REVIEW.

**Body** — `RejectTransactionDto`:
```json
{ "reason": "Receipt unreadable; please re-submit" }
```

**200 data**: updated transaction with `rejectedReason`.

---

## 👮 POST `/transactions/:id/mark-completed` (ADMIN, SUPER_ADMIN)

`APPROVED → COMPLETED` for BUY/SWAP only. SELL completes via Payout PAID.

**Atomic side effects**:
1. Transaction → COMPLETED
2. TransactionProof row (type OTHER) with the outbound hash
3. UserActivityLog (`TRANSACTION_COMPLETED`)
4. **ReferralCommission row** if user has a referrer (0.1% of fiatAmount for BUY; SWAP skipped)

**Body** — `MarkCompletedDto`:
```json
{
  "outboundTxHash": "outbound-hash-...",
  "notes": "Sent via Tron hot wallet"
}
```

**200 data**: updated transaction with `completedAt`.

**Errors**: `400` not APPROVED / called on SELL / missing outboundTxHash.

---

# 5. PAYOUTS — `/payouts/*` (SELL only)

State machine: `PENDING → PROCESSING → PAID` (terminal) · or `FAILED` · `FAILED → PENDING` retry.

## 🔒 GET `/payouts/me`

User's own payouts.

**Query**: `page`, `pageSize`, `status`.

**200 data**:
```json
{
  "payouts": [
    {
      "id": "cmpg...",
      "transactionId": "cmpg...",
      "bankAccountId": "cmpg...",
      "amount": "290000.00",
      "currency": "NGN",
      "status": "PENDING",
      "reference": "XCN-7503C7E4",
      "processedAt": null,
      "paidAt": null,
      "transaction": { ... },
      "bankAccount": {
        "bankName": "Guaranty Trust Bank",
        "accountNumber": "0123456789",
        "accountName": "Michael Adeleke"
      }
    }
  ],
  "total": 3,
  "page": 1,
  "pageSize": 20
}
```

---

## 🔒 GET `/payouts/me/:id`

**200 data**: payout with embedded transaction + bankAccount (full).

**Errors**: `404` not found / not yours.

---

## 👮 GET `/payouts` (ADMIN, SUPER_ADMIN)

Cross-user. Bank accounts in admin views are **MASKED**
(`accountNumberMasked`).

---

## 👮 GET `/payouts/:id` (ADMIN, SUPER_ADMIN)

**200 data**: payout with embedded transaction + **masked** bankAccount.

---

## 👮 PATCH `/payouts/:id/status` (ADMIN, SUPER_ADMIN)

**Body** — `UpdatePayoutStatusDto`:
```json
{
  "status": "PROCESSING",
  "failureReason": "Beneficiary bank rejected",
  "reference": "BANK-TXN-9988"
}
```

**Atomic side effects** on `→ PAID`:
1. `paidAt` stamped
2. Parent Transaction cascades `APPROVED → COMPLETED`
3. **ReferralCommission row** if the SELL'er has a referrer (0.1% of fiatAmount)

**200 data**: updated payout (masked bank account).

**Errors**: `400` illegal state transition.

---

# 6. RATES — `/rates/*`

## 🔒 GET `/rates/current`

Latest snapshot per **enabled** asset for NGN. Any authenticated user. Asset list is dynamic — new coins added via `/admin/assets` show up here automatically once an admin POSTs their first rate snapshot.

**200 data**:
```json
{
  "fiatCurrency": "NGN",
  "rates": [
    {
      "asset": {
        "id": "cmpqd99zz0000o81g4kq8jz5x",
        "symbol": "BTC",
        "name": "Bitcoin",
        "decimals": 8,
        "iconUrl": "https://cryptologos.cc/logos/bitcoin-btc-logo.png"
      },
      "buyRate": "70000000.00",
      "sellRate": "68000000.00",
      "source": "manual",
      "fetchedAt": "2026-05-28T14:30:00.000Z"
    }
  ]
}
```

`buyRate` = price WE sell at. `sellRate` = price WE buy at. The embedded `asset` object means the frontend can render the price row (symbol, icon, decimals) without a separate /assets call.

---

## 👮 POST `/rates` (ADMIN, SUPER_ADMIN)

Time-series: creates a NEW row.

**Body** — `CreateRateDto`:
```json
{
  "assetId": "cmpqd99zz0000o81g4kq8jz5x",
  "buyRate": "70000000.00",
  "sellRate": "68000000.00",
  "fiatCurrency": "NGN",
  "source": "manual"
}
```

`assetId` is a cuid from `GET /assets`. **No rate snapshot = no transactions for that asset (503)** — admin must record an initial rate before users can BUY/SELL/SWAP it.

**201 data**: new ExchangeRate with embedded `asset`.

---

## 👮 GET `/rates` (ADMIN, SUPER_ADMIN)

Paginated history.

**Query**: `page`, `pageSize`, `assetId`, `fiatCurrency`. Newest first. Each row includes embedded `asset`.

---

## 👮 GET `/rates/:id` (ADMIN, SUPER_ADMIN)

Single snapshot.

---

## 👮 PATCH `/rates/:id` (ADMIN, SUPER_ADMIN)

Edit a snapshot (typo fix). Asset/fiatCurrency immutable.

**Body** — `UpdateRateDto`:
```json
{ "buyRate": "70500000.00", "sellRate": "68500000.00" }
```

---

## 👮 DELETE `/rates/:id` (ADMIN, SUPER_ADMIN)

**204** — empty body.

---

# 7. WALLETS — `/wallets/*` (ADMIN ONLY)

Company-owned crypto wallets users send TO.

## 👮 POST `/wallets`

**Body** — `CreateWalletDto`:
```json
{
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "label": "Primary BTC hot wallet",
  "isActive": true
}
```

`assetNetworkId` is a cuid from `GET /assets` (each asset has a `networks` array with pair ids). Single FK guarantees the asset × network combination is valid.

**201 data**: new WalletAddress with embedded `assetNetwork` (asset + network details).

**Errors**: `400` invalid/disabled `assetNetworkId` · `409` duplicate `(assetNetworkId, address)`.

---

## 👮 GET `/wallets`

**Query**: `assetNetworkId`, `assetId`, `networkId`, `isActive`. Active first, then most recent.

`assetNetworkId` is the most specific filter. `assetId` returns all wallets for that coin across networks. `networkId` returns all wallets on that chain across coins.

**200 data**: array of wallets, each with embedded `assetNetwork`.

---

## 👮 GET `/wallets/:id`

Single wallet.

---

## 👮 PATCH `/wallets/:id`

Only `label` and `isActive` mutable.

**Body** — `UpdateWalletDto`:
```json
{ "label": "BTC retired", "isActive": false }
```

---

## 👮 DELETE `/wallets/:id`

Soft delete (`isActive = false`).

**200** with updated wallet.

---

# 7.5 ASSETS & NETWORKS — `/assets/*`, `/networks/*`, `/admin/{assets,networks,asset-networks}/*`

**The big change** in the latest version. The old `CryptoAsset` and `CryptoNetwork` enums (BTC/ETH/USDT/USDC × BITCOIN/ETHEREUM/TRON/BSC/POLYGON) are now database tables. Admins can add new coins (SOL, ARB, AVAX...) and networks (SOLANA, BASE, ARBITRUM...) at runtime via HTTP — no code deploy needed.

Three resources:

- **Asset** — one coin. Identified by `symbol` (IMMUTABLE post-create).
- **Network** — one blockchain. Identified by `code` (IMMUTABLE post-create).
- **AssetNetwork** — many-to-many join with per-pair config (contract address, decimals override, min deposit/withdrawal, withdrawal fee, confirmations required, enabled flag).

Wallets and Transactions reference the JOIN row (`assetNetworkId`) — one FK guarantees the combination is valid by construction.

## 🔒 GET `/assets`

Enabled assets with their enabled networks. Used by frontend coin/network pickers. Cached in-process 60s.

**200 data**:
```json
[
  {
    "id": "cmpqd99zz0000o81g4kq8jz5x",
    "symbol": "USDT",
    "name": "Tether USD",
    "decimals": 6,
    "iconUrl": "https://cryptologos.cc/logos/tether-usdt-logo.png",
    "isEnabled": true,
    "sortOrder": 30,
    "networks": [
      {
        "id": "cmpqe002b0001o81g8k7vmpqr",
        "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "minDeposit": "1.0",
        "withdrawalFee": "1.0",
        "confirmationsRequired": 12,
        "isEnabled": true,
        "network": { "id": "...", "code": "ETHEREUM", "name": "Ethereum", "chainId": 1 }
      }
    ]
  }
]
```

---

## 🔒 GET `/assets/:idOrSymbol`

Pass either the cuid (`cmp...`) or the uppercase symbol (`USDT`). Returns the asset with ALL pairs (incl. disabled).

**404** if not found.

---

## 🔒 GET `/networks`

Enabled networks, cached 60s.

**200 data**:
```json
[
  {
    "id": "cmpqd001a0000o81g4kq8jz5x",
    "code": "ETHEREUM",
    "name": "Ethereum",
    "chainId": 1,
    "explorerUrlTemplate": "https://etherscan.io/tx/{txHash}",
    "nativeAssetSymbol": "ETH",
    "isEnabled": true,
    "sortOrder": 20
  }
]
```

Use `explorerUrlTemplate` to deep-link transaction proofs: replace `{txHash}` with the actual hash.

---

## 👮 GET `/admin/assets` (ADMIN, SUPER_ADMIN)

Paginated, includes disabled.

**Query**: `page`, `pageSize`.

**200 data**: `{ assets: [...], total, page, pageSize }`.

---

## 👮 POST `/admin/assets` (ADMIN, SUPER_ADMIN)

Create a new asset, optionally with initial pair rows in one transaction.

**Body** — `CreateAssetDto`:
```json
{
  "symbol": "SOL",
  "name": "Solana",
  "decimals": 9,
  "iconUrl": "https://cryptologos.cc/logos/solana-sol-logo.png",
  "sortOrder": 60,
  "networks": [
    {
      "networkId": "cmpqd00solana0000xxxx0000",
      "minDeposit": "0.01",
      "withdrawalFee": "0.0025",
      "confirmationsRequired": 32
    }
  ]
}
```

`symbol` and `decimals` are **IMMUTABLE post-create** (changing decimals would corrupt every historical transaction's interpretation). The `networks` array is optional — add pairs later with `POST /admin/assets/:assetId/networks`.

**201 data**: created Asset with its `networks` array embedded.

**Errors**: `400` invalid networkId / duplicate in array / disabled network · `409` symbol collision.

---

## 👮 GET `/admin/assets/:id` (ADMIN, SUPER_ADMIN)

Single asset with ALL pairs (incl. disabled).

---

## 👮 PATCH `/admin/assets/:id` (ADMIN, SUPER_ADMIN)

Update mutable fields only: `name`, `iconUrl`, `isEnabled`, `sortOrder`. `symbol` and `decimals` cannot be changed.

**Body** — `UpdateAssetDto` (all optional):
```json
{ "name": "Solana Mainnet", "iconUrl": "...", "sortOrder": 100, "isEnabled": true }
```

---

## 👮 PATCH `/admin/assets/:id/enabled` (ADMIN, SUPER_ADMIN)

Convenience toggle for the disable switch.

**Body**: `{ "enabled": false }`. Disabling does NOT affect existing transactions — it only hides the asset from new coin pickers.

---

## 👮 DELETE `/admin/assets/:id` (ADMIN, SUPER_ADMIN)

Hard delete. **409** if any AssetNetwork pairs or transactions reference it. Prefer `isEnabled=false` to preserve history.

---

## 👮 POST `/admin/assets/:assetId/networks` (ADMIN, SUPER_ADMIN)

Attach a new network pair to an existing asset.

**Body** — `AssetNetworkInputDto`:
```json
{
  "networkId": "cmpqd001a0000o81g4kq8jz5x",
  "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "minDeposit": "1.0",
  "minWithdrawal": "1.0",
  "withdrawalFee": "1.0",
  "confirmationsRequired": 12,
  "isEnabled": true
}
```

`contractAddress` is required for tokens, null for native coins. `decimals` is an optional per-network override; leave null to inherit from `Asset.decimals`.

**Errors**: `404` asset not found · `409` asset already has a pair for this network (update the existing pair instead).

---

## 👮 PATCH `/admin/asset-networks/:id` (ADMIN, SUPER_ADMIN)

Update pair-specific config (contractAddress, decimals override, min deposit/withdrawal, withdrawal fee, confirmations, isEnabled). The (asset, network) binding is **IMMUTABLE** — to move to a different network, DELETE + recreate.

**Body** — `UpdateAssetNetworkDto` (all optional). Same shape as the input DTO above, minus `networkId`.

---

## 👮 DELETE `/admin/asset-networks/:id` (ADMIN, SUPER_ADMIN)

Hard delete. **409** if any transactions or wallets reference it.

---

## 👮 GET `/admin/networks` (ADMIN, SUPER_ADMIN)

Paginated. Same shape as the public list but includes disabled.

---

## 👮 POST `/admin/networks` (ADMIN, SUPER_ADMIN)

**Body** — `CreateNetworkDto`:
```json
{
  "code": "SOLANA",
  "name": "Solana",
  "chainId": null,
  "explorerUrlTemplate": "https://solscan.io/tx/{txHash}",
  "nativeAssetSymbol": "SOL",
  "isEnabled": true,
  "sortOrder": 60
}
```

`code` must be UPPERCASE (letters, digits, underscores) and is **IMMUTABLE post-create**.

**Errors**: `409` code collision.

---

## 👮 PATCH `/admin/networks/:id` (ADMIN, SUPER_ADMIN)

Update `name`, `chainId`, `explorerUrlTemplate`, `nativeAssetSymbol`, `isEnabled`, `sortOrder`. `code` cannot be changed.

---

## 👮 PATCH `/admin/networks/:id/enabled` (ADMIN, SUPER_ADMIN)

Toggle. **Body**: `{ "enabled": false }`.

---

## 👮 DELETE `/admin/networks/:id` (ADMIN, SUPER_ADMIN)

Hard delete. **409** if any AssetNetwork pairs reference it.

---

# 7.6 ADMIN BOOTSTRAP — `/admin/bootstrap` (one-time, public)

Public endpoint for minting the very first SUPER_ADMIN. Defended by a shared secret in `BOOTSTRAP_SECRET` env var (timing-safe comparison). Single-use by design.

## 🔓 POST `/admin/bootstrap`

**Body** — `BootstrapSuperAdminDto`:
```json
{
  "secret": "AUUEtbBhQbSZNT75M2oEIvoPZH5_SJOUqStTGL6z00pyoLKShASZXQLS8OpHy-X7",
  "email": "admin@xchangnow.com",
  "password": "C0rrectH0rseBatteryStaple!2026",
  "firstName": "Super",
  "lastName": "Admin"
}
```

`secret` must match `BOOTSTRAP_SECRET` env var (32-200 chars, compared timing-safely). Password rule is stricter than regular users: 12-128 chars with uppercase, lowercase, digit.

**201 data**: the created SafeUser (role=SUPER_ADMIN).

**Errors**:
- `404` `BOOTSTRAP_SECRET` env var unset — endpoint pretends not to exist
- `403` secret mismatch (HIGH-severity `security_log` row written)
- `409` SUPER_ADMIN already exists or email collision (single-use)

**After successful bootstrap**: REMOVE `BOOTSTRAP_SECRET` from prod env. The endpoint then permanently returns 404.

---

# 8. REFERRALS — `/referrals/*`

Every user gets a referral code at signup (`XCN-XXXXXX`). When their
referee completes a BUY or SELL transaction, the referrer earns 0.1% of
the trade's `fiatAmount` as a `ReferralCommission` row. SWAP commission
is deferred (no clean NGN basis yet).

## 🔒 GET `/referrals/me`

Dashboard widget — one call, everything for the "your referrals" card.

**200 data**:
```json
{
  "code": "XCN-A8K2P9",
  "shareUrl": "https://app.xchangnow.com/register?ref=XCN-A8K2P9",
  "totalReferees": 7,
  "totalEarningsNgn": "1284.50"
}
```

---

## 🔒 GET `/referrals/me/referees`

Paginated, newest first. Per-row earnings rollup.

**Query**: `page`, `pageSize`.

**200 data**:
```json
{
  "referees": [
    {
      "id": "cmpg...",
      "email": "tunde@example.com",
      "firstName": "Tunde",
      "lastName": "Bello",
      "joinedAt": "2026-05-22T13:00:00.000Z",
      "totalEarnedFromThemNgn": "450.00"
    }
  ],
  "total": 7,
  "page": 1,
  "pageSize": 20
}
```

---

## 🔒 GET `/referrals/me/earnings`

Raw commission ledger, newest first.

**Query**: `page`, `pageSize`.

**200 data**:
```json
{
  "earnings": [
    {
      "id": "cmpg...",
      "referrerId": "cmpg...",
      "refereeId": "cmpg...",
      "transactionId": "cmpg...",
      "amount": "290.00",
      "basisAmount": "290000.00",
      "basisCurrency": "NGN",
      "ratePercent": "0.0010",
      "createdAt": "2026-05-22T15:00:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20
}
```

---

# 9. ADMIN — `/admin/*`

## 👮 GET `/admin/ping`

Smoke test for the auth chain.

**200 data**:
```json
{
  "ok": true,
  "message": "Admin pong",
  "adminId": "cmpg...",
  "adminEmail": "admin@xchangnow.com",
  "adminRole": "ADMIN",
  "checkedAt": "2026-05-28T14:30:00.000Z"
}
```

---

## 👮 POST `/admin/staff` (SUPER_ADMIN only)

Invite a new staff member. Creates user with `PENDING_VERIFICATION`,
issues invite token, sends invite email.

**Body** — `CreateStaffDto`:
```json
{
  "email": "ops1@xchangnow.com",
  "firstName": "Tunde",
  "lastName": "Bello",
  "role": "OPS",
  "phoneNumber": "08012345670"
}
```

`role` must be one of `ADMIN | OPS | CUSTOMER_SERVICE`. SUPER_ADMIN
rejected at validation.

**201 data**:
```json
{
  "user": { /* invited user — masked phone */ },
  "inviteToken": "a1b2c3d4..."
}
```

`inviteToken` only in dev.

**Errors**

| Status | When |
|---|---|
| 400 | invalid role |
| 403 | not SUPER_ADMIN |
| 409 | email / phone / referral code collision |

---

## 👮 GET `/admin/staff` (ADMIN, SUPER_ADMIN)

Paginated non-USER accounts (the staff view).

**Query**: `page`, `pageSize`, `role`, `status`.

**200 data**: same shape as `GET /users` (masked phones).

Side effects: PiiAccessLog `STAFF LIST`.

---

## 👮 PATCH `/admin/staff/:id/role` (SUPER_ADMIN only)

Move staff between ADMIN ↔ OPS ↔ CUSTOMER_SERVICE.

**Body** — `UpdateStaffRoleDto`:
```json
{ "role": "ADMIN", "reason": "Promoted from OPS after Q2 review" }
```

**200 data**: updated user (masked).

**Errors**

| Status | When |
|---|---|
| 400 | role=SUPER_ADMIN/USER (rejected at DTO+service) |
| 403 | self-promotion / target is SUPER_ADMIN / not SUPER_ADMIN actor |
| 404 | staff not found |

Side effects: admin_log (`STAFF_ROLE_CHANGED`) + PiiAccessLog (`STAFF UPDATE`).

---

# 10. HEALTH — `/health`

## 🔓 GET `/health`

Process liveness. No DB hit. For load-balancer probes.

**200 data**:
```json
{
  "status": "ok",
  "service": "xchangnow-api",
  "uptimeSeconds": 1342,
  "timestamp": "2026-05-28T14:30:00.000Z"
}
```

---

# Enums reference

```ts
// CryptoAsset and CryptoNetwork are NO LONGER enums — they are database
// tables. The original seed values (BTC/ETH/USDT/USDC × BITCOIN/ETHEREUM/
// TRON/BSC/POLYGON) populate them initially; admins can add more at runtime
// via /admin/assets and /admin/networks. Reference them by cuid `id`,
// `Asset.symbol`, or `Network.code`. See section 7.5 above.
type TransactionType   = 'BUY' | 'SELL' | 'SWAP';
type TransactionStatus =
  | 'PENDING'             // SELL/SWAP awaiting user to send crypto
  | 'AWAITING_PAYMENT'    // BUY awaiting user bank transfer
  | 'UNDER_REVIEW'        // proof uploaded, admin reviewing
  | 'APPROVED'            // admin approved (waiting payout or admin-sent crypto)
  | 'COMPLETED'           // terminal — happy path
  | 'REJECTED'            // terminal — sad path (rejectedReason set)
  | 'EXPIRED'             // user didn't act within 30 min
  | 'CANCELLED';
type PayoutStatus      = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
type ProofType         = 'CRYPTO_TX_HASH' | 'BANK_TRANSFER_RECEIPT' | 'OTHER';
type UserStatus        = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION' | 'DEACTIVATED';
type Role              = 'USER' | 'ADMIN' | 'SUPER_ADMIN' | 'OPS' | 'CUSTOMER_SERVICE';
type KycStatus         = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
```

---

# Frontend integration notes

## Token handling

Recommended: store tokens in **httpOnly cookies** server-side, NOT in
localStorage (XSS vulnerable for a fintech). FE pages call Next.js Server
Actions / Route Handlers as thin proxies that:
1. Forward the request to this API
2. Pluck the tokens from the response
3. Set them as httpOnly cookies (`Secure`, `SameSite=Lax` for access,
   `SameSite=Strict` for refresh)
4. Return only the sanitized user data to the browser

## requestId for support

Every response includes `meta.requestId`. Show it in error toasts:

```
Something went wrong.
Reference: 28516a54-142e-49e5-98f2-c3044ba1697b
```

When a user reports an issue, `grep req=28516a54` in the API logs returns
the whole flow (entry + service logs + exit).

## When to show `message` as a toast

| HTTP method | Show `res.message`? |
|---|---|
| GET | ❌ Silent reads |
| POST / PATCH / DELETE — success | ✅ Confirmation toast |
| Any — error | ✅ User-facing reason |

## Phone format hint for the FE

Backend accepts ANY of:
- `08012345678`  (local with leading 0)
- `8012345678`   (local without leading 0)
- `2348012345678` (E.164 without +)
- `+2348012345678` (E.164)

All normalize to `+2348012345678` server-side. FE can show whatever the
user typed; backend stores both forms.

## Cloudinary upload for KYC selfie

1. Create an unsigned upload preset in your Cloudinary dashboard.
2. FE: `POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload`
   with the file + `upload_preset=<your_preset>`.
3. Take the `secure_url` from the response.
4. POST that URL to `/api/kyc/me` with the BVN/NIN.

Backend stores only the URL. Cloudinary holds the image.

---

**Last updated:** 2026-05-28. This file is sibling to `FOLDER_STRUCTURE.md`.
When adding a new endpoint, update both files.
