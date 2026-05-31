# Admin API Reference

Complete request/response shapes for every endpoint a staff user (ADMIN / SUPER_ADMIN / OPS) hits. Use this as the contract when wiring the admin FE.

All paths are prefixed with `/api`. All responses use the standard envelope:
```json
{ "success": true, "message": "...", "data": { /* per-endpoint */ }, "meta": { "requestId": "...", "timestamp": "..." } }
```
Examples below show just the **`data` payload** for brevity (or the `error` block for failures).

All endpoints require `Authorization: Bearer <accessToken>` from `POST /auth/login` **except** `POST /admin/bootstrap` (one-time public).

---

## Table of contents

1. [Smoke test](#1-admin-smoke-test) — `GET /admin/ping`
2. [Bootstrap (one-time)](#2-bootstrap--one-time-super_admin-creation) — `POST /admin/bootstrap`
3. [Assets (NEW)](#3-assets-new--dynamic-crypto-coin-management) — `/admin/assets`
4. [Networks (NEW)](#4-networks-new--dynamic-blockchain-management) — `/admin/networks`
5. [Asset-Network pairs (NEW)](#5-asset-network-pair-management-new) — `/admin/assets/:assetId/networks`, `/admin/asset-networks`
6. [Staff management](#6-staff-management) — `/admin/staff`
7. [User management](#7-user-management) — `/users`
8. [KYC review](#8-kyc-review) — `/kyc`
9. [Wallets](#9-wallets-company-owned-crypto-wallets-admin-only) — `/wallets`
10. [Rates](#10-rates) — `/rates`
11. [Transactions (admin)](#11-transactions-admin) — `/transactions`
12. [Payouts](#12-payouts) — `/payouts`
13. [Standard error envelope](#standard-error-envelope-fe-error-handler)

---

# 1. Admin smoke test

## `GET /admin/ping`

**Auth**: JWT + ADMIN | SUPER_ADMIN

**Response 200**:
```json
{
  "pong": true,
  "user": { "id": "cmp...", "role": "SUPER_ADMIN" }
}
```

Use this to verify the auth chain is wired on the FE before showing the dashboard.

---

# 2. Bootstrap — one-time SUPER_ADMIN creation

## `POST /admin/bootstrap`

**Auth**: NONE (public — defended by `BOOTSTRAP_SECRET` env var)

**Request body**:
```json
{
  "secret": "32+ char value matching BOOTSTRAP_SECRET env",
  "email": "admin@xchangnow.com",
  "password": "AtLeast12CharsWith1Upper1Lower1Digit!",
  "firstName": "Super",
  "lastName": "Admin"
}
```

**Response 201** (the created SafeUser):
```json
{
  "id": "cmpn6qabe0000o8n86fsgc2fi",
  "email": "admin@xchangnow.com",
  "firstName": "Super",
  "lastName": "Admin",
  "phoneNumber": null,
  "role": "SUPER_ADMIN",
  "status": "ACTIVE",
  "isEmailVerified": true,
  "lastLoginAt": null,
  "lastLoginIp": null,
  "createdAt": "2026-05-30T10:00:00.000Z",
  "updatedAt": "2026-05-30T10:00:00.000Z",
  "deletedAt": null
}
```

**Errors**:
- `400` validation (returns `error.details[]`)
- `403` secret mismatch (HIGH-severity security log written)
- `404` `BOOTSTRAP_SECRET` env var unset — endpoint pretends not to exist
- `409` a SUPER_ADMIN already exists OR email collision

After successful bootstrap, REMOVE `BOOTSTRAP_SECRET` from env. The endpoint then permanently 404s.

---

# 3. Assets (NEW — dynamic crypto coin management)

## `GET /admin/assets`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page` (default 1), `pageSize` (default 50)

**Response 200**:
```json
{
  "assets": [
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
            "chainId": 1
          },
          "createdAt": "2026-05-30T11:00:00.000Z",
          "updatedAt": "2026-05-30T11:00:00.000Z"
        }
      ]
    }
  ],
  "total": 10,
  "page": 1,
  "pageSize": 50
}
```

## `POST /admin/assets`

**Request body** — bare asset:
```json
{
  "symbol": "SOL",
  "name": "Solana",
  "decimals": 9,
  "iconUrl": "https://cryptologos.cc/logos/solana-sol-logo.png",
  "sortOrder": 80,
  "isEnabled": true
}
```

**Request body** — asset + initial network pairs (one atomic transaction):
```json
{
  "symbol": "ARB",
  "name": "Arbitrum",
  "decimals": 18,
  "sortOrder": 110,
  "networks": [
    {
      "networkId": "<existing-network-cuid>",
      "contractAddress": "0x912CE59144191C1204E64559FE8253a0e49E6548",
      "minDeposit": "1.0",
      "minWithdrawal": "1.0",
      "withdrawalFee": "0.5",
      "confirmationsRequired": 12,
      "isEnabled": true
    }
  ]
}
```

Required: `symbol` (2-10 uppercase, **immutable**), `name`, `decimals` (0-18, **immutable**). Optional: `iconUrl`, `sortOrder`, `isEnabled`, `networks[]` (max 20).

**Response 201**: same shape as one element of the list above.

**Errors**:
- `400` validation OR bad/duplicate/disabled `networkId` in `networks[]`
- `409` symbol already exists

## `GET /admin/assets/:id`

**Response 200**: single asset with ALL pairs (including disabled).

**Errors**: `404` not found

## `PATCH /admin/assets/:id`

**Request body** (all optional; `symbol` and `decimals` NOT editable):
```json
{
  "name": "Solana Mainnet",
  "iconUrl": "https://...",
  "isEnabled": true,
  "sortOrder": 80
}
```

**Response 200**: updated asset.

**Errors**: `404` not found

## `PATCH /admin/assets/:id/enabled`

Convenience toggle for the disable switch.

**Request body**:
```json
{ "enabled": false }
```

**Response 200**: updated asset.

## `DELETE /admin/assets/:id`

**Response 204** (no body)

**Errors**:
- `404` not found
- `409` referenced by AssetNetwork pairs or transactions — disable instead

---

# 4. Networks (NEW — dynamic blockchain management)

## `GET /admin/networks`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page` (default 1), `pageSize` (default 50)

**Response 200**:
```json
{
  "networks": [
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
  ],
  "total": 6,
  "page": 1,
  "pageSize": 50
}
```

## `POST /admin/networks`

**Request body**:
```json
{
  "code": "ARBITRUM",
  "name": "Arbitrum One",
  "chainId": 42161,
  "explorerUrlTemplate": "https://arbiscan.io/tx/{txHash}",
  "nativeAssetSymbol": "ETH",
  "isEnabled": true,
  "sortOrder": 70
}
```

Required: `code` (2-20 chars, UPPERCASE letters/digits/underscores, **immutable**), `name`. Optional: `chainId` (EVM only — omit for non-EVM), `explorerUrlTemplate`, `nativeAssetSymbol`, `isEnabled`, `sortOrder`.

**Response 201**: single network row.

**Errors**:
- `400` validation
- `409` code collision

## `GET /admin/networks/:id`

**Response 200**: single network row.

**Errors**: `404` not found

## `PATCH /admin/networks/:id`

**Request body** (all optional; `code` NOT editable):
```json
{
  "name": "Arbitrum One Mainnet",
  "chainId": 42161,
  "explorerUrlTemplate": "https://arbiscan.io/tx/{txHash}",
  "nativeAssetSymbol": "ETH",
  "isEnabled": true,
  "sortOrder": 70
}
```

**Response 200**: updated network.

## `PATCH /admin/networks/:id/enabled`

**Request body**: `{ "enabled": false }`

**Response 200**: updated network.

## `DELETE /admin/networks/:id`

**Response 204** (no body)

**Errors**:
- `404` not found
- `409` still referenced by AssetNetwork pairs

---

# 5. Asset-Network pair management (NEW)

Manages the per-pair config (contract address, fees, confirmations) on top of an existing asset + network.

## `POST /admin/assets/:assetId/networks`

Attach a new network to an existing asset.

**Request body**:
```json
{
  "networkId": "cmpqd001a0000o81g4kq8jz5x",
  "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "decimals": null,
  "minDeposit": "1.0",
  "minWithdrawal": "1.0",
  "withdrawalFee": "1.0",
  "confirmationsRequired": 12,
  "isEnabled": true
}
```

Required: `networkId`. Optional: everything else. `contractAddress` should be set for tokens, null for natives. `decimals` is an override — leave null to inherit from `Asset.decimals`.

**Response 201**:
```json
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
  "asset": { "id": "...", "symbol": "USDT", "name": "Tether USD", "decimals": 6, "iconUrl": "..." },
  "network": { "id": "...", "code": "ETHEREUM", "name": "Ethereum", "chainId": 1 },
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Errors**:
- `400` invalid/disabled networkId
- `404` asset not found
- `409` this asset already has a pair for this network

## `PATCH /admin/asset-networks/:id`

**Request body** (all optional; `networkId` NOT editable):
```json
{
  "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "decimals": 6,
  "minDeposit": "5.0",
  "minWithdrawal": "5.0",
  "withdrawalFee": "2.0",
  "confirmationsRequired": 12,
  "isEnabled": true
}
```

**Response 200**: updated pair with embedded `asset` + `network`.

**Errors**: `404` not found

## `DELETE /admin/asset-networks/:id`

**Response 204** (no body)

**Errors**:
- `404` not found
- `409` referenced by transactions or wallet addresses

---

# 6. Staff management

## `GET /admin/staff`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page` (default 1), `pageSize` (default 20), `role?` (`ADMIN | OPS | CUSTOMER_SERVICE`)

**Response 200**:
```json
{
  "staff": [
    {
      "id": "cmp...",
      "email": "ops@xchangnow.com",
      "firstName": "Funke",
      "lastName": "Adeyemi",
      "role": "OPS",
      "status": "ACTIVE",
      "isEmailVerified": true,
      "lastLoginAt": "2026-05-29T14:30:00.000Z",
      "createdAt": "2026-05-20T10:00:00.000Z"
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 20
}
```

## `POST /admin/staff`

**Auth**: SUPER_ADMIN only

**Request body**:
```json
{
  "email": "newhire@xchangnow.com",
  "firstName": "Chinedu",
  "lastName": "Okafor",
  "role": "OPS"
}
```

Sends an invite email with a single-use token. Recipient redeems via `POST /auth/accept-invite`.

**Response 201**:
```json
{
  "id": "cmp...",
  "email": "newhire@xchangnow.com",
  "firstName": "Chinedu",
  "lastName": "Okafor",
  "role": "OPS",
  "status": "PENDING_VERIFICATION",
  "inviteExpiresAt": "2026-06-06T11:00:00.000Z"
}
```

**Errors**:
- `400` validation
- `403` caller is not SUPER_ADMIN
- `409` email already registered

## `PATCH /admin/staff/:id/role`

**Auth**: SUPER_ADMIN only

**Request body**:
```json
{ "role": "ADMIN" }
```

Valid roles: `ADMIN | OPS | CUSTOMER_SERVICE` (cannot promote to SUPER_ADMIN — must use bootstrap or have one already).

**Response 200**: updated staff member.

**Errors**:
- `400` invalid role / cannot demote self / cannot change SUPER_ADMIN role
- `403` not SUPER_ADMIN
- `404` staff not found

---

# 7. User management

## `GET /users`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page`, `pageSize`, `status?` (`ACTIVE | SUSPENDED | PENDING_VERIFICATION | DEACTIVATED`), `search?` (matches email/firstName/lastName)

**Response 200**:
```json
{
  "users": [
    {
      "id": "cmp...",
      "email": "user@example.com",
      "phoneNumber": "+2348012345678",
      "firstName": "Michael",
      "lastName": "Adeleke",
      "role": "USER",
      "status": "ACTIVE",
      "isEmailVerified": true,
      "lastLoginAt": "2026-05-29T14:30:00.000Z",
      "lastLoginIp": "203.0.113.45",
      "createdAt": "2026-05-22T13:00:00.000Z",
      "updatedAt": "2026-05-29T14:30:00.000Z",
      "deletedAt": null
    }
  ],
  "total": 1247,
  "page": 1,
  "pageSize": 20
}
```

Soft-deleted users (`deletedAt != null`) are excluded.

## `GET /users/:id`

**Response 200**: single SafeUser (same fields as the list row). Includes soft-deleted users for admin investigation.

**Errors**: `404` not found

## `PATCH /users/:id/status`

**Request body**:
```json
{
  "status": "SUSPENDED",
  "reason": "Multiple high-risk login attempts from VPN"
}
```

Writes a `user_activity_log` row with `action=STATUS_CHANGED, metadata={ by, newStatus, reason }`.

**Response 200**: updated user.

**Errors**:
- `403` admin tried to deactivate themselves
- `404` not found

## `POST /users/:id/anonymize`

Right-to-be-forgotten flow. Irreversible. Atomically scrubs PII across User + Profile + BankAccount, revokes all sessions, deletes outstanding tokens. Transactions / payouts / audit logs preserved.

**Request body**:
```json
{
  "confirmEmail": "user@example.com",
  "reason": "User exercised GDPR/NDPR right to erasure (ticket #4521)"
}
```

`confirmEmail` MUST match the target user's current email (case-insensitive) — guard against fat-fingering the wrong id.

**Response 200**:
```json
{
  "message": "User anonymized",
  "anonymizedAt": "2026-05-30T14:30:00.000Z"
}
```

**Errors**:
- `403` self-anonymization, SUPER_ADMIN target, or confirmEmail mismatch
- `404` not found
- `409` already anonymized

---

# 8. KYC review

## `GET /kyc`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page`, `pageSize`, `status?` (`PENDING | APPROVED | REJECTED | NONE`)

**Response 200**:
```json
{
  "submissions": [
    {
      "userId": "cmp...",
      "user": {
        "email": "user@example.com",
        "firstName": "Michael",
        "lastName": "Adeleke"
      },
      "kycStatus": "PENDING",
      "documentType": "DRIVERS_LICENSE",
      "documentNumber": "ABC123456",
      "documentImageUrl": "https://res.cloudinary.com/...",
      "selfieImageUrl": "https://res.cloudinary.com/...",
      "dateOfBirth": "1995-04-12",
      "submittedAt": "2026-05-28T10:00:00.000Z",
      "reviewedAt": null,
      "reviewedById": null
    }
  ],
  "total": 23,
  "page": 1,
  "pageSize": 20
}
```

## `GET /kyc/:userId`

**Response 200**: single submission with `user` (full SafeUser) joined.

**Errors**: `404` user has no KYC submission

## `POST /kyc/:userId/approve`

**Request body**:
```json
{ "notes": "Document clear, selfie matches" }
```

**Response 200**:
```json
{
  "userId": "cmp...",
  "kycStatus": "APPROVED",
  "reviewedAt": "2026-05-30T14:30:00.000Z",
  "reviewedById": "cmpgx5qjh0000o85kzmyj8zpy"
}
```

**Errors**: `400` not in PENDING state · `404` not found

## `POST /kyc/:userId/reject`

**Request body**:
```json
{
  "reason": "Document expired",
  "notes": "Driver's license shows expiry 2024; please resubmit current"
}
```

`reason` is shown to the user; `notes` is admin-internal.

**Response 200**:
```json
{
  "userId": "cmp...",
  "kycStatus": "REJECTED",
  "rejectedReason": "Document expired",
  "reviewedAt": "2026-05-30T14:30:00.000Z",
  "reviewedById": "cmpgx5qjh0000o85kzmyj8zpy"
}
```

User can resubmit (which flips them back to PENDING).

---

# 9. Wallets (company-owned crypto wallets, admin-only)

## `POST /wallets`

**Auth**: ADMIN | SUPER_ADMIN

**Request body**:
```json
{
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "label": "Primary BTC hot wallet",
  "isActive": true
}
```

Address: 20-120 chars (length-validated only; per-chain format is admin's responsibility).

**Response 201**:
```json
{
  "id": "cmpgx5rxg000eo85k60xgd3fr",
  "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
  "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "label": "Primary BTC hot wallet",
  "isActive": true,
  "createdAt": "2026-05-30T12:00:00.000Z",
  "updatedAt": "2026-05-30T12:00:00.000Z",
  "assetNetwork": {
    "id": "cmpqe002b0001o81g8k7vmpqr",
    "asset": { "id": "...", "symbol": "BTC", "name": "Bitcoin", "decimals": 8 },
    "network": { "id": "...", "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
  }
}
```

**Errors**:
- `400` invalid/disabled assetNetworkId
- `409` `(assetNetworkId, address)` duplicate

## `GET /wallets`

**Query**: `assetNetworkId?`, `assetId?`, `networkId?`, `isActive?` (boolean string "true"/"false")

**Response 200**: array of wallets (no pagination — at most a handful). Each row includes embedded `assetNetwork`. Active sorted first.

## `GET /wallets/:id`

**Response 200**: single wallet with embedded assetNetwork.

**Errors**: `404` not found

## `PATCH /wallets/:id`

**Request body** (only `label` and `isActive` mutable):
```json
{ "label": "BTC retired", "isActive": false }
```

**Response 200**: updated wallet.

## `DELETE /wallets/:id`

Soft delete (sets `isActive=false`).

**Response 200**: updated wallet with `isActive: false`.

---

# 10. Rates

## `POST /rates`

**Auth**: ADMIN | SUPER_ADMIN

**Request body**:
```json
{
  "assetId": "cmpqd99zz0000o81g4kq8jz5x",
  "buyRate": "70000000.00",
  "sellRate": "68000000.00",
  "fiatCurrency": "NGN",
  "source": "manual"
}
```

Required: `assetId`, `buyRate`, `sellRate`. Optional: `fiatCurrency` (default NGN), `source` (default "manual"). Rates are decimal strings with up to 2 places (NGN cents).

Time-series — each POST creates a NEW row.

**Response 201**:
```json
{
  "id": "cmph19915000ho850d27tijhm",
  "assetId": "cmpqd99zz0000o81g4kq8jz5x",
  "fiatCurrency": "NGN",
  "buyRate": "70000000.00",
  "sellRate": "68000000.00",
  "source": "manual",
  "isManualOverride": true,
  "updatedById": "cmpgx5qjh0000o85kzmyj8zpy",
  "fetchedAt": "2026-05-30T14:30:00.000Z",
  "asset": {
    "id": "cmpqd99zz0000o81g4kq8jz5x",
    "symbol": "BTC",
    "name": "Bitcoin",
    "decimals": 8,
    "iconUrl": "https://..."
  }
}
```

**Errors**:
- `400` invalid assetId (doesn't exist)

## `GET /rates`

Paginated history.

**Query**: `page`, `pageSize`, `assetId?`, `fiatCurrency?`

**Response 200**:
```json
{
  "rates": [ /* same shape as POST 201, with embedded asset */ ],
  "total": 124,
  "page": 1,
  "pageSize": 20
}
```

## `GET /rates/:id`

**Response 200**: single rate with embedded asset.

**Errors**: `404` not found

## `PATCH /rates/:id`

Typo fix only. Asset / fiatCurrency immutable.

**Request body** (all optional):
```json
{
  "buyRate": "70500000.00",
  "sellRate": "68500000.00",
  "source": "manual-correction"
}
```

**Response 200**: updated rate.

## `DELETE /rates/:id`

**Response 204** (no body)

**Errors**: `404` not found

---

# 11. Transactions (admin)

## `GET /transactions`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page`, `pageSize`, `status?`, `type?` (`BUY | SELL | SWAP`), `assetId?`, `assetNetworkId?`, `userId?`

**Response 200**:
```json
{
  "transactions": [
    {
      "id": "cmpgzemmo0009o8nkp8cc9pk7",
      "referenceCode": "XCN-A55A2689",
      "userId": "cmpgx5qjh0000o85kzmyj8zpy",
      "type": "SELL",
      "status": "UNDER_REVIEW",
      "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
      "cryptoAmount": "0.005",
      "toAssetNetworkId": null,
      "toAmount": null,
      "toAddress": null,
      "fiatAmount": "290000.00",
      "fiatCurrency": "NGN",
      "rate": "58000000.00",
      "walletAddressId": "cmpg...",
      "txHash": "a1b2c3...",
      "expiresAt": "2026-05-30T15:00:00.000Z",
      "createdAt": "2026-05-30T14:30:00.000Z",
      "assetNetwork": {
        "id": "...",
        "asset": { "symbol": "BTC", "name": "Bitcoin", "decimals": 8 },
        "network": { "code": "BITCOIN", "name": "Bitcoin", "chainId": null }
      },
      "toAssetNetwork": null,
      "walletAddress": { /* embedded */ },
      "proofs": [ /* uploaded proofs */ ]
    }
  ],
  "total": 312,
  "page": 1,
  "pageSize": 20
}
```

For SWAP rows, `toAssetNetwork` is populated.

## `GET /transactions/:id`

**Response 200**: full transaction with `proofs[]`, `walletAddress`, `assetNetwork`, `toAssetNetwork` (SWAP), `user` (id/email/name). For BUY also includes `paymentInstructions`.

**Errors**: `404` not found

## `POST /transactions/:id/approve`

`UNDER_REVIEW → APPROVED`. For SELL: also creates a PENDING Payout atomically.

**Request body**:
```json
{ "notes": "Tx hash verified on Blockstream — 3 confirmations" }
```

**Response 200**: updated transaction with `approvedById`, `approvedAt`.

**Errors**:
- `400` not in UNDER_REVIEW / SELL user no longer has default bank
- `404` not found

## `POST /transactions/:id/reject`

**Request body**:
```json
{ "reason": "Receipt unreadable; please re-submit" }
```

Allowed sources: `PENDING | AWAITING_PAYMENT | UNDER_REVIEW`. The reason is shown to the user.

**Response 200**: updated transaction with `rejectedReason`.

## `POST /transactions/:id/mark-completed`

`APPROVED → COMPLETED` for BUY/SWAP only. SELL completes via Payout PAID, not here.

**Request body**:
```json
{
  "outboundTxHash": "outbound-hash-...",
  "notes": "Sent via Tron hot wallet"
}
```

Atomic side effects:
1. Transaction → COMPLETED, `completedAt` stamped
2. TransactionProof row (type=OTHER) records the outbound hash
3. UserActivityLog (TRANSACTION_COMPLETED)
4. ReferralCommission row if user has a referrer (0.1% of fiatAmount on BUY; SWAP skipped)

**Response 200**: updated transaction with `completedAt`.

**Errors**:
- `400` not APPROVED / called on SELL / missing outboundTxHash
- `404` not found

---

# 12. Payouts

## `GET /payouts`

**Auth**: ADMIN | SUPER_ADMIN

**Query**: `page`, `pageSize`, `status?` (`PENDING | PROCESSING | PAID | FAILED`)

**Response 200**:
```json
{
  "payouts": [
    {
      "id": "cmpg...",
      "transactionId": "cmpg8s3180009o8sk1t0qywog",
      "bankAccountId": "cmpg...",
      "amount": "290000.00",
      "currency": "NGN",
      "status": "PENDING",
      "reference": "XCN-7503C7E4",
      "failureReason": null,
      "processedById": null,
      "processedAt": null,
      "paidAt": null,
      "createdAt": "2026-05-30T14:30:00.000Z",
      "updatedAt": "2026-05-30T14:30:00.000Z",
      "transaction": {
        "id": "cmpg8s3180009o8sk1t0qywog",
        "referenceCode": "XCN-7503C7E4",
        "type": "SELL",
        "status": "APPROVED",
        "assetNetworkId": "cmpqe002b0001o81g8k7vmpqr",
        "cryptoAmount": "0.005",
        "fiatAmount": "290000.00",
        "assetNetwork": {
          "id": "...",
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
  "total": 87,
  "page": 1,
  "pageSize": 20
}
```

## `GET /payouts/:id`

**Response 200**: single payout with embedded transaction + bank account.

**Errors**: `404` not found

## `PATCH /payouts/:id/status`

State machine: `PENDING → PROCESSING → PAID` (terminal) · OR `FAILED` · `FAILED → PENDING` for retry.

**Request body** for `→ PROCESSING`:
```json
{ "status": "PROCESSING" }
```

**Request body** for `→ PAID`:
```json
{
  "status": "PAID",
  "notes": "Sent via GTBank corporate at 14:32"
}
```

**Request body** for `→ FAILED`:
```json
{
  "status": "FAILED",
  "failureReason": "Bank rejected — invalid account number"
}
```

**Atomic side effects** on `→ PAID`:
1. `paidAt` stamped
2. Parent Transaction cascades `APPROVED → COMPLETED`
3. ReferralCommission row if the SELL'er has a referrer (0.1% of fiatAmount)

**Response 200**: updated payout.

**Errors**: `400` illegal state transition · `404` not found

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

FE pattern: switch on `error.code` for behavior, show `message` as toast, log `meta.requestId` for support tickets.

---

# Permissions cheat-sheet

| Concern | OPS | ADMIN | SUPER_ADMIN |
|---|---|---|---|
| Read assets/networks/pairs | ✅ | ✅ | ✅ |
| Write assets/networks/pairs | ❌ | ✅ | ✅ |
| Read users/KYC/transactions/payouts | ✅ | ✅ | ✅ |
| Approve/reject transactions, payouts, KYC | ✅ | ✅ | ✅ |
| Suspend/anonymize users | ❌ | ✅ | ✅ |
| Manage wallets | ❌ | ✅ | ✅ |
| Set rates | ❌ | ✅ | ✅ |
| Invite staff | ❌ | ❌ | ✅ |
| Change staff roles | ❌ | ❌ | ✅ |
| Bootstrap endpoint | (public, secret-gated, one-time) |

(OPS = view + operate on transactions/payouts/KYC; ADMIN = + manage system catalog/users/wallets/rates; SUPER_ADMIN = + manage staff itself.)
