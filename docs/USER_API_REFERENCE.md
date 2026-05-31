# User API Reference

Every endpoint a regular USER hits from the customer-facing dashboard. Use this as the contract when wiring the user FE.

All paths prefixed with `/api`. All responses use the standard envelope (see the bottom of this doc).

Auth markers used below:
- 🔓 **Public** — no JWT required
- 🔒 **Authenticated** — JWT required (any role)
- ✅ **Authenticated + verified email** — JWT + `isEmailVerified=true`

🆕 = brand-new endpoint in the dynamic-assets refactor.
🔄 = existing endpoint with updated request/response shape.

---

## Table of contents

1. [Auth flows](#1-auth-flows) — register, login, refresh, verify, password reset
2. [Profile (self)](#2-profile-self) — `/users/me`
3. [Bank accounts (self)](#3-bank-accounts-self) — `/bank-accounts/me`
4. [KYC (self)](#4-kyc-self) — `/kyc/me`
5. [🆕 Assets & Networks (catalog read)](#5--assets--networks-catalog-read) — `/assets`, `/networks`
6. [🔄 Rates](#6--rates) — `/rates/current`
7. [🔄 Transactions](#7--transactions-self) — BUY / SELL / SWAP
8. [Payouts (self, read-only)](#8-payouts-self-read-only) — `/payouts/me`
9. [Referrals](#9-referrals) — `/referrals/me`
10. [Health](#10-health) — `/health`
11. [Standard error envelope](#standard-error-envelope-fe-error-handler)

---

# 1. Auth flows

## 🔓 `POST /auth/register`

Create a new USER account. **No tokens issued** — user must verify email first, then `POST /auth/login`. A verification email is sent.

**Request body**:
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
| `email` | ✓ | RFC email, max 254 chars |
| `password` | ✓ | 8-128 chars, must contain UPPER + lower + digit |
| `firstName` | ✓ | 1-60 chars |
| `lastName` | ✓ | 1-60 chars |
| `phoneNumber` | — | NG format (accepts `0801…`, `+234…`, etc.) |
| `referralCode` | — | Existing user's code; unknown → 400 |

**Response 201**:
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

> `verifyToken` is only present in dev (`NODE_ENV != production`). In prod, the token only goes via email.

**Errors**:
- `400` validation errors (`error.details[]` per field) OR `"Unknown referral code: ..."`
- `409` `"Email already registered"` or `"Phone number already registered"`

## 🔓 `POST /auth/login`

Strict gate — only `ACTIVE` users with verified email may log in.

**Request body**:
```json
{ "email": "michael@example.com", "password": "StrongP@ss1" }
```

**Response 200**:
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

**Errors** — all `401`, FE branches on `message`:

| Message | What FE does |
|---|---|
| `"Email or password incorrect"` | Show "wrong credentials" |
| `"Invalid credentials"` | Same — wrong password specifically |
| `"Please verify your email before logging in..."` | Show "Resend verification" CTA |
| `"Account not active"` | "Account suspended — contact support" |
| `"Too many failed attempts. Try again later."` | Rate-limit countdown |

## 🔓 `POST /auth/refresh`

Rotate the refresh + access tokens. Old refresh token is revoked atomically.

**Request body**:
```json
{ "refreshToken": "eEt8r2Vh3LkPq9aBxNm..." }
```

**Response 200**:
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

## 🔒 `POST /auth/logout`

Revokes the current session only. Other sessions on other devices unaffected.

**Request body**: none.

**Response 204** — empty body.

## 🔒 `GET /auth/me`

Lightweight identity from the JWT. For full profile use `GET /users/me`.

**Response 200**:
```json
{
  "id": "cmpgx5qjh0000o85kzmyj8zpy",
  "email": "michael@example.com",
  "role": "USER",
  "sessionId": "cmpg9k3lk0009o84wjn521kk4"
}
```

## 🔓 `POST /auth/verify-email`

Consume the email link's token. On success: user → `ACTIVE`, `isEmailVerified=true`, all outstanding verification tokens for this user are deleted.

**Request body**:
```json
{ "token": "a1b2c3d4..." }
```

**Response 200**:
```json
{ "message": "Email verified" }
```

**Errors**: `400` token invalid / expired.

## 🔓 `POST /auth/resend-verification`

Generic response — never reveals whether the account exists.

**Request body**:
```json
{ "email": "michael@example.com" }
```

**Response 200**:
```json
{ "message": "If the account exists and is unverified, a new email has been sent" }
```

## 🔓 `POST /auth/forgot-password`

**Request body**:
```json
{ "email": "michael@example.com" }
```

**Response 200**:
```json
{
  "message": "If an account exists for that email, a reset link has been sent",
  "resetToken": "a1b2c3d4..."
}
```

> `resetToken` only present in dev.

## 🔓 `POST /auth/reset-password`

Atomic: sets new password, marks token used, **revokes ALL active sessions** for this user, writes `PASSWORD_RESET` security log.

**Request body**:
```json
{ "token": "a1b2c3d4...", "newPassword": "NewStrongP@ss2" }
```

**Response 200**:
```json
{ "message": "Password reset successful. Please log in with your new password." }
```

**Errors**: `400` token invalid / used / expired (>1h).

## 🔓 `POST /auth/accept-invite`

For invited staff. Atomic: sets password, status → `ACTIVE`, `isEmailVerified=true`, marks invite token used, writes security_log.

**Request body**:
```json
{ "token": "a1b2c3d4...", "password": "StaffP@ss1!" }
```

**Response 200**:
```json
{ "message": "Invite accepted. Your account is active — please log in with your new password." }
```

**Errors**: `400` token invalid / used / expired.

---

# 2. Profile (self)

## 🔒 `GET /users/me`

Full self-profile.

**Response 200**: same shape as register's `user` (all fields, no `passwordHash`).

## 🔒 `PATCH /users/me`

All fields optional — omit to leave unchanged. `phoneNumber: ""` clears phone (both raw and normalized null'd).

**Request body**:
```json
{
  "firstName": "Michael",
  "lastName": "Adeleke",
  "phoneNumber": "08012345678"
}
```

**Response 200**: updated user.

**Errors**: `409` phone collides with another user's normalized form.

---

# 3. Bank accounts (self)

Moved out of `/users/me/*` into their own controller. Routes are now under `/bank-accounts/me`.

## 🔒 `GET /bank-accounts/me`

Default-first, then oldest first.

**Response 200**:
```json
[
  {
    "id": "cmpgx5ryo000go85kxlbxwzn7",
    "userId": "cmpgx5qjh0000o85kzmyj8zpy",
    "bankName": "Guaranty Trust Bank",
    "accountNumber": "0123456789",
    "accountName": "Michael Adeleke",
    "isDefault": true,
    "createdAt": "2026-05-22T13:00:00.000Z",
    "updatedAt": "2026-05-22T13:00:00.000Z"
  }
]
```

## 🔒 `POST /bank-accounts/me`

If `isDefault=true`, the previously-default account is auto-unset atomically (the "at-most-one-default" invariant).

**Request body**:
```json
{
  "bankName": "Guaranty Trust Bank",
  "accountNumber": "0123456789",
  "accountName": "Michael Adeleke",
  "isDefault": true
}
```

**Response 201**: new bank account.

**Errors**: `409` duplicate `(userId, bankName, accountNumber)`.

## 🔒 `PATCH /bank-accounts/me/:id`

All fields optional. Setting `isDefault=true` reassigns the default atomically.

**Response 200**: updated bank account.

**Errors**: `404` not found / not yours.

## 🔒 `DELETE /bank-accounts/me/:id`

Hard delete. Refused if any payouts reference it.

**Response 204** — empty body.

**Errors**: `404` not found / not yours · `409` has payouts attached.

---

# 4. KYC (self)

## 🔒 `POST /kyc/me`

Submit BVN + NIN (at least one) + selfie URL.

**Request body**:
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

**Response 201** (`KycSelfView`):
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

Side effects: PiiAccessLog `KYC_DOCUMENT CREATE`.

**Errors**:
- `400` `"At least one of bvn or nin is required"`
- `409` BVN/NIN already used by another account OR KYC already approved

## 🔒 `GET /kyc/me`

User views own status. Does NOT decrypt BVN/NIN.

**Response 200**: same `KycSelfView` shape as submit.

---

# 5. 🆕 Assets & Networks (catalog read)

These power the **dynamic coin/network pickers** on the BUY / SELL / SWAP pages. Replaces the old hardcoded `BTC | ETH | USDT | USDC` × `BITCOIN | ETHEREUM | TRON | BSC | POLYGON` enum dropdowns.

Backend caches these reads for 60s. Frontend SHOULD also cache (e.g. React Query `staleTime: 60_000`).

## 🆕 🔒 `GET /assets`

Enabled assets with their enabled network pairs eagerly loaded.

**Response 200**:
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
    "createdAt": "2026-05-30T11:00:00.000Z",
    "updatedAt": "2026-05-30T11:00:00.000Z",
    "networks": [
      {
        "id": "cmpqe002b0001o81g8k7vmpqr",
        "assetId": "cmpqd99zz0000o81g4kq8jz5x",
        "networkId": "cmpqd001a0000o81g4kq8jz5x",
        "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "decimals": null,
        "minDeposit": "1.0",
        "minWithdrawal": "1.0",
        "withdrawalFee": "1.0",
        "confirmationsRequired": 12,
        "isEnabled": true,
        "network": {
          "id": "cmpqd001a0000o81g4kq8jz5x",
          "code": "ETHEREUM",
          "name": "Ethereum",
          "chainId": 1,
          "explorerUrlTemplate": "https://etherscan.io/tx/{txHash}",
          "nativeAssetSymbol": "ETH"
        }
      }
    ]
  }
]
```

The `networks[]` array on each asset contains the **AssetNetwork pair rows** — the per-pair config (contract address, fees, confirmations) plus the embedded `network` for display. Use `pair.id` as the value you submit in transaction bodies (`assetNetworkId`).

## 🆕 🔒 `GET /assets/:idOrSymbol`

Pass either the cuid (`cmp...`) or the uppercase symbol (`USDT`). Server detects which.

**Response 200**: single asset, same shape as one element of the list — but `networks[]` includes **disabled** pairs too (useful for showing "USDT-BSC temporarily unavailable" in the UI).

**Errors**: `404` not found.

## 🆕 🔒 `GET /networks`

Enabled networks, cached 60s. Use this to render a "view all networks we support" page or for the picker's second step.

**Response 200**:
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
    "sortOrder": 20,
    "createdAt": "2026-05-30T11:00:00.000Z",
    "updatedAt": "2026-05-30T11:00:00.000Z"
  }
]
```

The `explorerUrlTemplate` is for building transaction proof deep-links — replace `{txHash}` with the actual hash.

---

# 6. 🔄 Rates

## 🔒 `GET /rates/current`

Latest snapshot per **enabled** asset for NGN. Asset list is dynamic — new coins admins add show up here automatically once they record a rate snapshot. Assets with no rate snapshot are omitted (signal to the FE: can't trade them yet).

**Query** (all optional): `fiatCurrency` (default `"NGN"`).

**Response 200**:
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
      "fetchedAt": "2026-05-30T14:30:00.000Z"
    },
    {
      "asset": { "id": "...", "symbol": "USDT", "name": "Tether USD", "decimals": 6, "iconUrl": "..." },
      "buyRate": "1600.00",
      "sellRate": "1550.00",
      "source": "manual",
      "fetchedAt": "2026-05-30T14:30:00.000Z"
    }
  ]
}
```

`buyRate` = price WE sell at. `sellRate` = price WE buy at. The spread is the platform fee.

**Note**: rates are per-asset, not per-asset-network. Whether the user holds USDT on Tron or Ethereum doesn't change the NGN price — only the network fee differs (which lives on `AssetNetwork.withdrawalFee`).

---

# 7. 🔄 Transactions (self)

State machine:
```
SELL/SWAP: PENDING ──► UNDER_REVIEW ──► APPROVED ──► COMPLETED
BUY:       AWAITING_PAYMENT ──► UNDER_REVIEW ──► APPROVED ──► COMPLETED
                            └─► REJECTED (with rejectedReason)
                            └─► EXPIRED (if user doesn't act within 30 min)
```

**Big change**: every create endpoint now takes a single `assetNetworkId` (or `fromAssetNetworkId` + `toAssetNetworkId` for swap) instead of the old `cryptoAsset` + `network` enum pair. Use the picker to resolve these from `GET /assets` → `asset.networks[i].id`.

Responses now embed the full `assetNetwork` chain (asset + network) on the primary and (for SWAP) the to-side, so the FE never needs a separate lookup.

## ✅ `POST /transactions/sell`

Customer sells crypto → gets NGN payout to default bank.

**Preconditions**: verified email + has a default bank account + active company wallet exists for the chosen pair.

**Request body**:
```json
{
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "cryptoAmount": "0.005"
}
```

`cryptoAmount` is a decimal STRING (preserves precision beyond JS number limits), up to 18 places.

**Response 201**:
```json
{
  "id": "cmpgzemmo0009o8nkp8cc9pk7",
  "referenceCode": "XCN-A55A2689",
  "userId": "cmpgx5qjh0000o85kzmyj8zpy",
  "type": "SELL",
  "status": "PENDING",
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "cryptoAmount": "0.005",
  "toAssetNetworkId": null,
  "toAmount": null,
  "toAddress": null,
  "fiatAmount": "290000.00",
  "fiatCurrency": "NGN",
  "rate": "58000000.00",
  "walletAddressId": "cmpgx5rxg000eo85k60xgd3fr",
  "txHash": null,
  "riskScore": 0,
  "approvedById": null,
  "approvedAt": null,
  "rejectedReason": null,
  "expiresAt": "2026-05-30T15:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-05-30T14:30:00.000Z",
  "updatedAt": "2026-05-30T14:30:00.000Z",
  "assetNetwork": {
    "id": "cmpqe002b0001o81g8k7vmpqr",
    "asset": { "id": "...", "symbol": "BTC", "name": "Bitcoin", "decimals": 8, "iconUrl": "..." },
    "network": { "id": "...", "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
  },
  "toAssetNetwork": null,
  "walletAddress": {
    "id": "cmpgx5rxg000eo85k60xgd3fr",
    "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
    "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "label": "Primary BTC",
    "isActive": true,
    "assetNetwork": { /* same nested shape */ }
  },
  "proofs": []
}
```

After this 201, the FE should show: "Send `0.005 BTC` on the `Bitcoin` network to address `bc1q...`" — pulling values from `walletAddress.address` + `assetNetwork.network.code`.

**Errors**:
- `400` no default bank account / no active wallet for pair / invalid or disabled `assetNetworkId`
- `403` email not verified
- `503` no recent rate for this asset (admin must record an initial rate before users can trade it)

## ✅ `POST /transactions/buy`

Customer pays NGN bank transfer → gets crypto sent by admin.

**Request body**:
```json
{
  "assetNetworkId": "cmpqe003c0002o81g4abcdef",
  "fiatAmount": "30000.00"
}
```

`fiatAmount` is decimal string, up to 2 places (NGN cents).

**Response 201**:
```json
{
  "id": "cmpg8k53f000bo84wu80ay5lo",
  "referenceCode": "XCN-7503C7E4",
  "userId": "cmpgx5qjh0000o85kzmyj8zpy",
  "type": "BUY",
  "status": "AWAITING_PAYMENT",
  "assetNetworkId": "cmpqe003c0002o81g4abcdef",
  "cryptoAmount": "20.000000000000000000",
  "toAssetNetworkId": null,
  "fiatAmount": "30000.00",
  "fiatCurrency": "NGN",
  "rate": "1500.00",
  "walletAddressId": null,
  "expiresAt": "2026-05-30T15:00:00.000Z",
  "createdAt": "2026-05-30T14:30:00.000Z",
  "assetNetwork": {
    "id": "cmpqe003c0002o81g4abcdef",
    "asset": { "symbol": "USDT", "name": "Tether USD", "decimals": 6, "iconUrl": "..." },
    "network": { "code": "TRON", "name": "Tron", "chainId": null }
  },
  "toAssetNetwork": null,
  "paymentInstructions": {
    "bankName": "Wema Bank",
    "accountNumber": "0123456789",
    "accountName": "XchangNow Ltd",
    "reference": "XCN-7503C7E4"
  }
}
```

`paymentInstructions` is **only** present on BUY responses. The user must include `paymentInstructions.reference` in their bank transfer narration so the admin can match it. Re-rendered on every `GET /transactions/me/:id` read.

**Errors**:
- `400` invalid/disabled `assetNetworkId`
- `403` email not verified
- `503` no recent rate

## ✅ `POST /transactions/swap`

Crypto-to-crypto. User sends FROM-asset to our company wallet; we send TO-asset to their `toAddress` after admin approval.

**Request body**:
```json
{
  "fromAssetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "fromAmount": "0.005",
  "toAssetNetworkId": "cmpqe003c0002o81g4abcdef",
  "toAddress": "TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt"
}
```

Validation rules enforced server-side:
- `fromAssetNetworkId !== toAssetNetworkId` (rejected as 400)
- The two pairs must reference DIFFERENT **assets** — same-asset cross-network bridging (e.g. USDT-ETH ↔ USDT-TRON) is REJECTED. Bridging is a separate future feature.

Address is length-validated only (20-120 chars). Per-chain format validation deferred — context-aware help text on the FE is the right place for that.

**Response 201**: transaction with BOTH `assetNetwork` and `toAssetNetwork` embedded, `toAmount` computed server-side via cross-rate.

```json
{
  "id": "cmpg...",
  "referenceCode": "XCN-...",
  "type": "SWAP",
  "status": "PENDING",
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "cryptoAmount": "0.005",
  "toAssetNetworkId": "cmpqe003c0002o81g4abcdef",
  "toAmount": "193.333333333333333334",
  "toAddress": "TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt",
  "rate": "38666.666666666666667",
  "fiatAmount": null,
  "fiatCurrency": null,
  "walletAddressId": "cmpg...",
  "expiresAt": "2026-05-30T15:00:00.000Z",
  "assetNetwork": {
    "id": "cmpqe002b0001o81g8k7vmpqr",
    "asset": { "symbol": "BTC", "name": "Bitcoin", "decimals": 8 },
    "network": { "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
  },
  "toAssetNetwork": {
    "id": "cmpqe003c0002o81g4abcdef",
    "asset": { "symbol": "USDT", "name": "Tether USD", "decimals": 6 },
    "network": { "code": "TRON", "name": "Tron", "chainId": null }
  },
  "walletAddress": { /* embedded BTC company wallet */ }
}
```

**Errors**:
- `400` same `assetNetworkId` on both sides / same asset cross-network (bridging) / no active wallet for FROM pair / invalid/disabled pair
- `403` email not verified
- `503` no recent rate for either asset

## 🔒 `GET /transactions/me`

Paginated, scoped to caller.

**Query**: `page`, `pageSize`, `status?`, `type?` (`BUY | SELL | SWAP`), `assetId?`, `assetNetworkId?`.

`assetId` filters by the primary asset across all networks. `assetNetworkId` filters by an exact pair (more specific). Pass either, not both.

**Response 200**:
```json
{
  "transactions": [ /* each shaped like the SELL/BUY/SWAP response above */ ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

## 🔒 `GET /transactions/me/:id`

Single transaction with `proofs[]`, `walletAddress`, `assetNetwork`, `toAssetNetwork` (SWAP only). BUY responses include `paymentInstructions`.

**Errors**: `404` not found / not yours (same response — anti-enumeration).

## ✅ `POST /transactions/me/:id/proof`

Records proof + atomically advances the transaction to `UNDER_REVIEW`. For SELL/SWAP, the hash also lands on `transaction.txHash` (system-wide @unique = anti-replay).

**Request body**:
```json
{
  "type": "CRYPTO_TX_HASH",
  "value": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "notes": "Sent at 02:30 GMT, 3 confirmations"
}
```

| Transaction type | Required proof type | `value` is... |
|---|---|---|
| SELL | `CRYPTO_TX_HASH` | the on-chain hash they sent |
| SWAP | `CRYPTO_TX_HASH` | same |
| BUY | `BANK_TRANSFER_RECEIPT` | URL of the receipt image |

**Response 201**:
```json
{
  "id": "cmpgzemqx000bo8nkghlr93p3",
  "transactionId": "cmpgzemmo0009o8nkp8cc9pk7",
  "type": "CRYPTO_TX_HASH",
  "url": "a1b2c3d4...",
  "notes": null,
  "uploadedAt": "2026-05-30T14:35:00.000Z"
}
```

Server also flips the parent transaction to `UNDER_REVIEW` in the same DB transaction.

**Errors**:
- `400` wrong proof type for tx type / tx not in `PENDING` or `AWAITING_PAYMENT`
- `403` email not verified
- `404` tx not yours / doesn't exist
- `409` this tx hash has already been submitted (anti-replay, system-wide)

---

# 8. Payouts (self, read-only)

Payouts are generated automatically when an admin approves a SELL — the user can't create them, only view them.

State machine: `PENDING → PROCESSING → PAID` (terminal) · `FAILED` · `FAILED → PENDING` (admin retry).

## 🔒 `GET /payouts/me`

**Query**: `page`, `pageSize`, `status?` (`PENDING | PROCESSING | PAID | FAILED`).

**Response 200**:
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
      "failureReason": null,
      "processedAt": null,
      "paidAt": null,
      "createdAt": "2026-05-30T14:30:00.000Z",
      "transaction": {
        "id": "cmpg...",
        "referenceCode": "XCN-7503C7E4",
        "type": "SELL",
        "status": "APPROVED",
        "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
        "cryptoAmount": "0.005",
        "fiatAmount": "290000.00",
        "assetNetwork": {
          "asset": { "symbol": "BTC", "name": "Bitcoin", "decimals": 8 },
          "network": { "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
        }
      },
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

## 🔒 `GET /payouts/me/:id`

**Response 200**: payout with embedded transaction (including `assetNetwork`) + bank account (full account number — caller is reading their own).

**Errors**: `404` not found / not yours.

---

# 9. Referrals

Every user gets a referral code at signup (`XCN-XXXXXX`). When their referee completes a BUY or SELL transaction, the referrer earns 0.1% of the trade's `fiatAmount` as a `ReferralCommission` row. SWAP commission is deferred (no clean NGN basis yet).

## 🔒 `GET /referrals/me`

Dashboard widget — one call, everything for the "your referrals" card.

**Response 200**:
```json
{
  "code": "XCN-A8K2P9",
  "shareUrl": "https://app.xchangnow.com/register?ref=XCN-A8K2P9",
  "totalReferees": 7,
  "totalEarningsNgn": "1284.50"
}
```

## 🔒 `GET /referrals/me/referees`

Paginated, newest first. Per-row earnings rollup.

**Query**: `page`, `pageSize`.

**Response 200**:
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

## 🔒 `GET /referrals/me/earnings`

Raw commission ledger, newest first.

**Query**: `page`, `pageSize`.

**Response 200**:
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
      "createdAt": "2026-05-30T15:00:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20
}
```

---

# 10. Health

## 🔓 `GET /health`

Liveness + readiness probe. Used by uptime monitors.

**Response 200**:
```json
{
  "status": "ok",
  "service": "xchangnow-api",
  "uptimeSeconds": 1342,
  "timestamp": "2026-05-30T14:30:00.000Z"
}
```

---

# Standard error envelope (FE error handler)

Every non-2xx response:

```json
{
  "success": false,
  "message": "human-readable summary",
  "data": null,
  "error": {
    "code": "BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | UNPROCESSABLE_ENTITY | INTERNAL_SERVER_ERROR | SERVICE_UNAVAILABLE",
    "details": ["array of class-validator messages or a single error string"]
  },
  "meta": {
    "requestId": "uuid-for-support-lookup",
    "timestamp": "2026-05-30T14:30:00.000Z",
    "path": "/api/..."
  }
}
```

**FE pattern**:
- Switch on `error.code` for behavior
- Show `message` as toast
- Log `meta.requestId` for support tickets
- For 400s, walk `error.details[]` to render per-field errors on the form

---

# Frontend integration cheat-sheet

**Coin/network picker** — single reusable component, used everywhere transactions are created:

```ts
// 1. Fetch + cache assets (60s stale time)
const { data: assets } = useQuery({
  queryKey: ['assets'],
  queryFn: () => api.get<Asset[]>('/assets'),
  staleTime: 60_000,
});

// 2. User picks asset → networks dropdown shows asset.networks[]
const [assetId, setAssetId] = useState<string>();
const [pairId, setPairId] = useState<string>();
const asset = assets?.find(a => a.id === assetId);
const networks = asset?.networks ?? [];

// 3. Submit pair.id as assetNetworkId
await api.post('/transactions/buy', {
  assetNetworkId: pairId,
  fiatAmount: amount,
});
```

**Display pattern** for transaction rows / details — use the embedded `assetNetwork`:

```tsx
<TxRow>
  {tx.cryptoAmount} {tx.assetNetwork.asset.symbol}
  <small>on {tx.assetNetwork.network.name}</small>
  {tx.type === 'SWAP' && (
    <>→ {tx.toAmount} {tx.toAssetNetwork!.asset.symbol} on {tx.toAssetNetwork!.network.name}</>
  )}
</TxRow>
```

**Explorer deep-link** for proof tx hashes:

```ts
const tpl = tx.assetNetwork.network.explorerUrlTemplate;
const url = tpl ? tpl.replace('{txHash}', tx.txHash) : null;
```

**Withdrawal fee / minimum display** on the SELL/SWAP confirmation step — pull from the selected pair:

```tsx
<small>
  Network fee: {pair.withdrawalFee ?? '0'} {asset.symbol} ·
  Min withdrawal: {pair.minWithdrawal ?? '0'} {asset.symbol} ·
  {pair.confirmationsRequired} confirmations required
</small>
```
