# XchangNow — Admin / Management Frontend Spec

Spec for the **management dashboard** (SUPER_ADMIN, ADMIN, OPS,
CUSTOMER_SERVICE). The customer-facing user dashboard is a separate doc.

Stack recommendation: **Next.js 14+ App Router**, TanStack Query for data
fetching, react-hook-form + zod for forms, shadcn/ui + Tailwind for primitives,
TanStack Table for data grids.

---

## 1. Role permissions matrix

Every endpoint listed here is enforced by the backend's `@Roles(...)` guard;
the FE should mirror the matrix in its **sidebar visibility + button
disabled states**. Backend is the source of truth — don't rely on FE-only
gating.

| Capability | SUPER_ADMIN | ADMIN | OPS | CUSTOMER_SERVICE |
|---|:---:|:---:|:---:|:---:|
| **Dashboard / KPIs** | ✓ | ✓ | ✓ | ✓ |
| **Users — list + view** | ✓ | ✓ |   | ✓ (read-only) |
| **Users — change status** | ✓ | ✓ |   | ✓ (suspend only) |
| **Users — anonymize (right-to-be-forgotten)** | ✓ | ✓ |   |   |
| **Transactions — view all** | ✓ | ✓ | ✓ | ✓ |
| **Transactions — approve / reject** | ✓ | ✓ | ✓ |   |
| **Transactions — mark COMPLETED (BUY/SWAP)** | ✓ | ✓ | ✓ |   |
| **Payouts — view all** | ✓ | ✓ | ✓ | ✓ |
| **Payouts — update status (PROCESSING / PAID / FAILED)** | ✓ | ✓ | ✓ |   |
| **Rates — view current + history** | ✓ | ✓ | ✓ | ✓ |
| **Rates — add / edit / delete snapshots** | ✓ | ✓ | ✓ |   |
| **Wallets — view** | ✓ | ✓ | ✓ |   |
| **Wallets — CRUD** | ✓ | ✓ | ✓ |   |
| **KYC — view queue + detail (decrypted BVN/NIN)** | ✓ | ✓ | ✓ |   |
| **KYC — approve / reject** | ✓ | ✓ | ✓ |   |
| **Staff — list** | ✓ | ✓ |   |   |
| **Staff — invite (POST)** | ✓ |   |   |   |
| **Staff — change role** | ✓ |   |   |   |
| **Audit / PII access logs** | ✓ | ✓ |   |   |

⚠️ **Current backend behavior:** today most admin routes are gated as
`@Roles(ADMIN, SUPER_ADMIN)`. OPS and CUSTOMER_SERVICE need broader access
above; either (a) widen the backend `@Roles` lists OR (b) leave backend as-is
and treat the matrix as "future state". Recommended: widen backend now so
the FE doesn't have to special-case.

---

## 2. Folder structure

Folded into a single Next.js app under a route group `(admin)`. The
customer FE shares the same project; only the `(admin)` group is described
here.

```
admin-frontend/
├── app/
│   ├── layout.tsx                  # Root layout: providers (QueryClient,
│   │                               # theme, sonner Toaster)
│   ├── (auth)/
│   │   └── login/page.tsx          # Admin login (same backend endpoint
│   │                               # as users; role gate happens after)
│   ├── (admin)/                    # Route group — every page below requires
│   │                               # JWT + admin role
│   │   ├── layout.tsx              # Admin chrome (sidebar + topbar +
│   │   │                           # role-gated nav)
│   │   ├── page.tsx                # /admin — dashboard home (KPIs)
│   │   ├── users/
│   │   │   ├── page.tsx            # /admin/users — list + filters
│   │   │   └── [id]/page.tsx       # /admin/users/:id — detail + actions
│   │   ├── transactions/
│   │   │   ├── page.tsx            # /admin/transactions
│   │   │   └── [id]/page.tsx       # /admin/transactions/:id — approve/reject
│   │   ├── payouts/
│   │   │   ├── page.tsx            # /admin/payouts
│   │   │   └── [id]/page.tsx       # /admin/payouts/:id — status update
│   │   ├── rates/
│   │   │   ├── page.tsx            # /admin/rates — current + history
│   │   │   └── new/page.tsx        # /admin/rates/new — add snapshot
│   │   ├── wallets/
│   │   │   ├── page.tsx            # /admin/wallets — list
│   │   │   ├── new/page.tsx        # /admin/wallets/new
│   │   │   └── [id]/page.tsx       # /admin/wallets/:id — edit
│   │   ├── kyc/
│   │   │   ├── page.tsx            # /admin/kyc — review queue
│   │   │   └── [userId]/page.tsx   # /admin/kyc/:userId — full review
│   │   ├── staff/                  # SUPER_ADMIN only at the route level
│   │   │   ├── page.tsx            # /admin/staff — list
│   │   │   ├── invite/page.tsx     # /admin/staff/invite
│   │   │   └── [id]/page.tsx       # /admin/staff/:id — role management
│   │   └── settings/
│   │       └── page.tsx            # /admin/settings — admin's own profile
│   │
│   └── api/                        # Next.js Route Handlers (proxy layer)
│       ├── auth/
│       │   ├── login/route.ts      # POST → backend, set httpOnly cookies
│       │   ├── logout/route.ts     # Backend logout + clear cookies
│       │   └── refresh/route.ts    # Refresh tokens
│       └── proxy/[...path]/route.ts # Generic proxy: client → /api/proxy/* →
│                                   # backend, attaches cookie tokens
│
├── components/
│   ├── ui/                         # shadcn/ui primitives (Button, Card,
│   │                               # Dialog, Input, Select, Table, Toast)
│   ├── layout/
│   │   ├── admin-sidebar.tsx       # Role-gated nav links
│   │   ├── admin-topbar.tsx        # Current admin + logout
│   │   ├── breadcrumbs.tsx
│   │   └── role-gate.tsx           # <RoleGate roles={['SUPER_ADMIN']}>...
│   ├── users/
│   │   ├── users-table.tsx
│   │   ├── user-status-badge.tsx
│   │   ├── user-detail-card.tsx
│   │   ├── change-status-dialog.tsx
│   │   └── anonymize-dialog.tsx    # Confirm-email guard built in
│   ├── transactions/
│   │   ├── transactions-table.tsx
│   │   ├── transaction-status-badge.tsx
│   │   ├── transaction-type-badge.tsx
│   │   ├── proof-viewer.tsx        # Renders tx hash w/ explorer link OR
│   │   │                           # receipt image
│   │   ├── approve-dialog.tsx
│   │   ├── reject-dialog.tsx
│   │   └── mark-completed-dialog.tsx
│   ├── payouts/
│   │   ├── payouts-table.tsx
│   │   ├── payout-status-badge.tsx
│   │   └── update-status-dialog.tsx
│   ├── rates/
│   │   ├── current-rates-card.tsx  # Live tiles, one per asset
│   │   ├── rate-history-chart.tsx  # Recharts line chart
│   │   ├── new-rate-form.tsx
│   │   └── edit-rate-dialog.tsx
│   ├── wallets/
│   │   ├── wallets-table.tsx
│   │   ├── wallet-form.tsx         # Shared create/edit
│   │   └── wallet-address-display.tsx  # Truncated w/ copy
│   ├── kyc/
│   │   ├── kyc-queue-table.tsx
│   │   ├── kyc-detail-view.tsx     # Decrypted BVN/NIN + selfie + actions
│   │   ├── kyc-approve-button.tsx
│   │   ├── kyc-reject-dialog.tsx
│   │   └── kyc-status-badge.tsx
│   ├── staff/
│   │   ├── staff-table.tsx
│   │   ├── invite-staff-form.tsx
│   │   ├── change-role-dialog.tsx
│   │   └── role-badge.tsx
│   └── shared/
│       ├── data-table.tsx          # TanStack Table base
│       ├── pagination.tsx
│       ├── filter-bar.tsx
│       ├── confirm-dialog.tsx
│       ├── error-toast.tsx         # Shows message + requestId
│       ├── empty-state.tsx
│       ├── loading-spinner.tsx
│       ├── currency-display.tsx    # Formats Decimal strings
│       └── datetime-display.tsx    # Relative + absolute on hover
│
├── lib/
│   ├── api/
│   │   ├── client.ts               # fetch wrapper: envelope unwrap,
│   │   │                           # error throw, requestId capture
│   │   ├── auth.ts                 # login(), logout(), getMe(), refresh()
│   │   ├── users.ts                # listUsers, getUser, updateStatus, anonymize
│   │   ├── transactions.ts         # listAll, getOne, approve, reject, markCompleted
│   │   ├── payouts.ts              # listAll, getOne, updateStatus
│   │   ├── rates.ts                # current, list, create, get, update, delete
│   │   ├── wallets.ts              # list, get, create, update, deactivate
│   │   ├── kyc.ts                  # listAll, getDetail, approve, reject
│   │   └── staff.ts                # list, invite, updateRole
│   ├── auth/
│   │   ├── session.ts              # Cookie read/write helpers
│   │   ├── rbac.ts                 # Role → allowed routes/actions map
│   │   └── current-user-context.tsx
│   ├── hooks/
│   │   ├── use-auth.ts             # Read current admin
│   │   ├── use-toast.ts            # sonner wrapper
│   │   ├── use-confirm.ts          # Reusable confirm dialog
│   │   ├── use-paginated-query.ts  # TanStack Query + URL state
│   │   └── use-mutation-toast.ts   # Auto-toast on success/error
│   ├── format.ts                   # money(), shortDate(), maskPhone()
│   ├── constants.ts                # API URLs, defaults
│   └── types/
│       ├── envelope.ts             # ResponseEnvelope, ErrorEnvelope
│       ├── user.ts
│       ├── transaction.ts
│       ├── payout.ts
│       ├── rate.ts
│       ├── wallet.ts
│       ├── kyc.ts
│       └── staff.ts
│
├── middleware.ts                   # Next.js middleware: cookie check,
│                                   # role gate on /admin/* routes
└── public/
```

---

## 3. Auth flow (entry point for everything)

### Login

```
[Login page]
   ↓ submit { email, password }
[POST /api/auth/login (Next.js Route Handler)]
   ↓ forwards to backend /api/auth/login
[Backend returns { user, tokens }]
   ↓ Route Handler sets two cookies:
       access_token  (httpOnly, 15m, SameSite=Lax)
       refresh_token (httpOnly, 7d,  SameSite=Strict)
   ↓ returns { user } to browser
[Browser stores user in React Context (NOT tokens — they're in cookies)]
   ↓
[Check user.role]
   - USER → redirect to customer dashboard (not admin)
   - ADMIN | SUPER_ADMIN | OPS | CUSTOMER_SERVICE → redirect to /admin
```

**Endpoint**: `POST /api/auth/login`

**Body**:
```json
{ "email": "admin@xchangnow.com", "password": "..." }
```

**200 response (data field)**:
```json
{
  "user": {
    "id": "cmpg...",
    "email": "admin@xchangnow.com",
    "firstName": "Super",
    "lastName": "Admin",
    "phoneNumber": "+2348012345678",
    "role": "SUPER_ADMIN",
    "status": "ACTIVE",
    "isEmailVerified": true,
    "lastLoginAt": "2026-05-28T14:30:00.000Z",
    "lastLoginIp": "203.0.113.45",
    "createdAt": "2026-05-22T13:00:00.000Z",
    "updatedAt": "2026-05-28T14:30:00.000Z",
    "deletedAt": null
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eEt8r2...",
    "accessExpiresIn": "15m",
    "refreshExpiresIn": "7d"
  }
}
```

**Errors (401 — branch on message)**:
- `"Email or password incorrect"` → "Wrong email or password"
- `"Please verify your email before logging in..."` → "Verify email" CTA
- `"Account not active"` → "Account suspended — contact support"
- `"Too many failed attempts. Try again later."` → rate-limit countdown

### Middleware (route protection)

```ts
// middleware.ts pseudo-code
export async function middleware(req) {
  const path = req.nextUrl.pathname;
  const accessToken = req.cookies.get('access_token');

  // Public routes
  if (path === '/login' || path.startsWith('/api/auth')) return NextResponse.next();

  // Admin routes
  if (path.startsWith('/admin')) {
    if (!accessToken) return NextResponse.redirect(new URL('/login', req.url));

    const payload = decodeJwt(accessToken.value);
    const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'CUSTOMER_SERVICE'];
    if (!adminRoles.includes(payload.role)) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  // SUPER_ADMIN-only routes
  if (path.startsWith('/admin/staff')) {
    const payload = decodeJwt(accessToken.value);
    if (payload.role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/admin', req.url));
    }
  }

  return NextResponse.next();
}
```

---

## 4. Page-by-page spec

### 4.1 Dashboard home — `/admin`

**Roles**: all admin roles
**Purpose**: KPI overview + action queues

**Components**:
- 4 KPI cards (UNDER_REVIEW count, PENDING payouts count, PENDING KYC count, today's volume)
- "Action needed" lists (recent UNDER_REVIEW txs, oldest PENDING payouts, oldest PENDING KYC)
- Recent admin actions (last 10 entries from admin_logs if/when exposed)

**Endpoints called**:

| Endpoint | Why |
|---|---|
| `GET /api/proxy/transactions?status=UNDER_REVIEW&pageSize=1` | Count badge |
| `GET /api/proxy/payouts?status=PENDING&pageSize=1` | Count badge |
| `GET /api/proxy/kyc?status=PENDING&pageSize=1` | Count badge |
| `GET /api/proxy/transactions?status=UNDER_REVIEW&pageSize=5` | Queue preview |
| `GET /api/proxy/payouts?status=PENDING&pageSize=5` | Queue preview |
| `GET /api/proxy/kyc?status=PENDING&pageSize=5` | Queue preview |

(Total counts come from the envelope's `data.total` field on each list call.)

---

### 4.2 Users list — `/admin/users`

**Roles**: SUPER_ADMIN, ADMIN, CUSTOMER_SERVICE (read-only for CS)

**Components**:
- `FilterBar`: status dropdown + search input
- `UsersTable` (TanStack Table): id (truncated), email, name, phoneNumberMasked, role, status badge, joined date
- `Pagination`
- Click row → `/admin/users/:id`

**Endpoint**: `GET /api/proxy/users?page=1&pageSize=20&status=ACTIVE&search=mike`

**200 response (data field)**:
```json
{
  "users": [
    {
      "id": "cmpgx5qjh0000o85kzmyj8zpy",
      "email": "michael@example.com",
      "firstName": "Michael",
      "lastName": "Adeleke",
      "phoneNumberMasked": "+234***5678",
      "role": "USER",
      "status": "ACTIVE",
      "isEmailVerified": true,
      "lastLoginAt": "2026-05-26T14:30:00.000Z",
      "lastLoginIp": "203.0.113.45",
      "createdAt": "2026-05-22T13:00:00.000Z",
      "updatedAt": "2026-05-26T14:30:00.000Z",
      "deletedAt": null
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

Phone is **masked** (`phoneNumberMasked`) — admins never see full numbers in
the listing. Side effect: backend writes one `pii_access_logs` row per call.

---

### 4.3 User detail — `/admin/users/:id`

**Roles**: same as list

**Components**:
- `UserDetailCard`: all fields including `phoneNumberMasked`, role, status, KYC status, member since
- Actions card (role-gated buttons):
  - Change Status → `ChangeStatusDialog` (SUSPEND / REACTIVATE / etc.)
  - **Anonymize** → `AnonymizeDialog` (SUPER_ADMIN, ADMIN only)
- Tabs:
  - Transactions (embedded `TransactionsTable` filtered by `userId`)
  - Payouts (embedded `PayoutsTable` filtered by `userId`)
  - Bank Accounts (read-only — no backend endpoint exists for admin to see user's bank accounts as of today, so omit until added)
  - Activity log (when exposed)

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/users/:id` | On page load |
| `PATCH /api/proxy/users/:id/status` | Change status dialog submit |
| `POST /api/proxy/users/:id/anonymize` | Anonymize dialog submit |
| `GET /api/proxy/transactions?userId=:id&...` | Transactions tab |
| `GET /api/proxy/payouts?userId=:id&...` | Payouts tab |

**`GET /api/proxy/users/:id` 200 response (data field)**:
```json
{
  "id": "cmpgx5qjh0000o85kzmyj8zpy",
  "email": "michael@example.com",
  "firstName": "Michael",
  "lastName": "Adeleke",
  "phoneNumberMasked": "+234***5678",
  "role": "USER",
  "status": "ACTIVE",
  "isEmailVerified": true,
  "lastLoginAt": "2026-05-26T14:30:00.000Z",
  "lastLoginIp": "203.0.113.45",
  "createdAt": "2026-05-22T13:00:00.000Z",
  "updatedAt": "2026-05-26T14:30:00.000Z",
  "deletedAt": null
}
```

**`PATCH /api/proxy/users/:id/status` body**:
```json
{ "status": "SUSPENDED", "reason": "Suspicious withdrawal pattern" }
```

200 response: updated user (masked shape).

**`POST /api/proxy/users/:id/anonymize` body** (sensitive — FE must show
confirmation dialog with the email pre-displayed):
```json
{
  "confirmEmail": "michael@example.com",
  "reason": "User requested account deletion under NDPR Article 26"
}
```

200 response:
```json
{
  "message": "User anonymized",
  "anonymizedAt": "2026-05-28T14:30:00.000Z"
}
```

Error cases (FE must handle all):
- 403 `"You cannot anonymize your own account"` — self-anonymization
- 403 `"SUPER_ADMIN accounts cannot be anonymized via this endpoint"`
- 403 `"confirmEmail does not match the target user's email"` — fat-finger
- 404 `"User not found"`
- 409 `"User is already anonymized"`

---

### 4.4 Transactions list — `/admin/transactions`

**Roles**: SUPER_ADMIN, ADMIN, OPS, CUSTOMER_SERVICE (read for CS)

**Components**:
- `FilterBar`: status, type, asset, userId (optional)
- `TransactionsTable`: ref code, type badge, status badge, customer email, crypto amount, fiat amount, created, actions
- Default filter: `status=UNDER_REVIEW` (the review queue)

**Endpoint**: `GET /api/proxy/transactions?status=UNDER_REVIEW&page=1&pageSize=20`

**200 response (data field)**:
```json
{
  "transactions": [
    {
      "id": "cmpgzemmo0009o8nkp8cc9pk7",
      "referenceCode": "XCN-A55A2689",
      "userId": "cmpgx5qjh0000o85kzmyj8zpy",
      "type": "SELL",
      "status": "UNDER_REVIEW",
      "cryptoAsset": "BTC",
      "network": "BITCOIN",
      "cryptoAmount": "0.005",
      "fiatAmount": "290000.00",
      "fiatCurrency": "NGN",
      "rate": "58000000.00",
      "walletAddressId": "cmpg...",
      "txHash": "a1b2c3d4...",
      "riskScore": 0,
      "approvedById": null,
      "approvedAt": null,
      "rejectedReason": null,
      "expiresAt": "2026-05-28T15:00:00.000Z",
      "completedAt": null,
      "createdAt": "2026-05-28T14:30:00.000Z",
      "updatedAt": "2026-05-28T14:35:00.000Z",
      "proofs": [
        {
          "id": "cmpg...",
          "transactionId": "cmpg...",
          "type": "CRYPTO_TX_HASH",
          "url": "a1b2c3d4...",
          "notes": null,
          "uploadedAt": "2026-05-28T14:35:00.000Z"
        }
      ],
      "walletAddress": {
        "id": "cmpg...",
        "cryptoAsset": "BTC",
        "network": "BITCOIN",
        "address": "bc1qxy...",
        "label": "Primary BTC",
        "isActive": true
      }
    }
  ],
  "total": 8,
  "page": 1,
  "pageSize": 20
}
```

---

### 4.5 Transaction detail — `/admin/transactions/:id`

**Roles**: same as list

**Components**:
- Header: ref code + status badge + type badge
- `TransactionDetailCard`: all fields + user info
- `ProofViewer`: for CRYPTO_TX_HASH → tx hash + explorer link (Blockstream/Tronscan/Etherscan based on network); for BANK_TRANSFER_RECEIPT → render image inline
- Customer card: email, name, KYC status, link to user profile
- Action buttons (role-gated):
  - **Approve** (UNDER_REVIEW only) → `ApproveDialog`
  - **Reject** (PENDING/AWAITING_PAYMENT/UNDER_REVIEW) → `RejectDialog`
  - **Mark Completed** (BUY/SWAP only, APPROVED only) → `MarkCompletedDialog`

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/transactions/:id` | On page load |
| `POST /api/proxy/transactions/:id/approve` | Approve dialog |
| `POST /api/proxy/transactions/:id/reject` | Reject dialog |
| `POST /api/proxy/transactions/:id/mark-completed` | Mark Completed dialog |

**`GET /api/proxy/transactions/:id` 200 response (data field)** — adds
embedded user:
```json
{
  "id": "cmpg...",
  "referenceCode": "XCN-A55A2689",
  "type": "SELL",
  "status": "UNDER_REVIEW",
  /* ...all the same fields as in list... */
  "proofs": [ { /* ... */ } ],
  "walletAddress": { /* ... */ },
  "user": {
    "id": "cmpg...",
    "email": "michael@example.com",
    "firstName": "Michael",
    "lastName": "Adeleke"
  }
}
```

**`POST /api/proxy/transactions/:id/approve` body**:
```json
{ "notes": "Tx hash verified on Blockstream — 6 confirmations" }
```

200 response: updated transaction with `approvedById`, `approvedAt`,
`status: "APPROVED"`. For SELL, the FE should also refresh `/admin/payouts`
because a PENDING payout was auto-created.

**`POST /api/proxy/transactions/:id/reject` body**:
```json
{ "reason": "Receipt unreadable; please re-submit clearer image" }
```

200 response: updated transaction with `rejectedReason`, `status: "REJECTED"`.

**`POST /api/proxy/transactions/:id/mark-completed` body**:
```json
{
  "outboundTxHash": "outbound-hash-9f8e...",
  "notes": "Sent via Tron hot wallet at 14:25 GMT"
}
```

200 response: updated transaction with `status: "COMPLETED"`, `completedAt` set.

Side effect: if the user has a referrer, a `ReferralCommission` row is
created atomically (0.1% of fiatAmount).

---

### 4.6 Payouts list — `/admin/payouts`

**Roles**: SUPER_ADMIN, ADMIN, OPS, CUSTOMER_SERVICE (read for CS)

**Components**:
- `FilterBar`: status
- `PayoutsTable`: ref, customer email, amount NGN, **`accountNumberMasked`**, status, processedAt, paidAt, actions
- Default filter: `status=PENDING`

**Endpoint**: `GET /api/proxy/payouts?status=PENDING&page=1&pageSize=20`

**200 response (data field)** — bank account is **masked**:
```json
{
  "payouts": [
    {
      "id": "cmpg8s3pq000do8sknhn8myhd",
      "transactionId": "cmpg8s3180009o8sk1t0qywog",
      "bankAccountId": "cmpgx5ryo000go85kxlbxwzn7",
      "amount": "290000.00",
      "currency": "NGN",
      "status": "PENDING",
      "reference": "XCN-7503C7E4",
      "failureReason": null,
      "processedById": null,
      "processedAt": null,
      "paidAt": null,
      "createdAt": "2026-05-28T14:30:00.000Z",
      "updatedAt": "2026-05-28T14:30:00.000Z",
      "transaction": {
        "id": "cmpg...",
        "referenceCode": "XCN-7503C7E4",
        "type": "SELL",
        "status": "APPROVED",
        "cryptoAsset": "BTC",
        "cryptoAmount": "0.005",
        "fiatAmount": "290000.00"
      },
      "bankAccount": {
        "id": "cmpg...",
        "userId": "cmpg...",
        "bankName": "Guaranty Trust Bank",
        "accountNumberMasked": "******6789",
        "accountName": "Michael Adeleke",
        "isDefault": true,
        "createdAt": "...",
        "updatedAt": "..."
      }
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20
}
```

⚠️ The `accountNumber` field is **NOT present** — only `accountNumberMasked`.
This is intentional. The admin processing the payout will need the full
account number for the actual bank transfer; for v1 this is handled
out-of-band (admin checks with the customer / via a separate workflow).
A future "view full bank details" endpoint can be added with extra PII audit.

---

### 4.7 Payout detail — `/admin/payouts/:id`

**Roles**: same as list

**Components**:
- Payout summary
- Transaction summary (embedded, linkable to `/admin/transactions/:txId`)
- Bank info card (**masked**)
- State machine UI: shows current state + buttons for valid transitions
- `UpdateStatusDialog`: status selector + (if FAILED) reason + (if PROCESSING) reference

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/payouts/:id` | On page load |
| `PATCH /api/proxy/payouts/:id/status` | Status update dialog |

**`PATCH /api/proxy/payouts/:id/status` body** (PROCESSING):
```json
{
  "status": "PROCESSING",
  "reference": "BANK-TXN-9988"
}
```

**Body (PAID)** — terminal:
```json
{ "status": "PAID" }
```

**Body (FAILED)**:
```json
{
  "status": "FAILED",
  "failureReason": "Beneficiary bank rejected transfer"
}
```

200 response: updated payout (with **masked** bankAccount).

Critical side effect on PAID:
1. Parent Transaction cascades `APPROVED → COMPLETED`
2. `ReferralCommission` row created if customer has a referrer
3. FE should also refresh the linked transaction view

---

### 4.8 KYC review queue — `/admin/kyc`

**Roles**: SUPER_ADMIN, ADMIN, OPS

**Components**:
- `FilterBar`: status (default PENDING)
- `KycQueueTable`: userId (link), email, name, status badge, submittedAt, hasBvn ✓, hasNin ✓
- Sort: oldest first (so queue is fair)

**Endpoint**: `GET /api/proxy/kyc?status=PENDING&page=1&pageSize=20`

**200 response (data field)**:
```json
{
  "submissions": [
    {
      "userId": "cmpg...",
      "email": "tunde@example.com",
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

---

### 4.9 KYC detail — `/admin/kyc/:userId`

**Roles**: SUPER_ADMIN, ADMIN, OPS

**Components**:
- `KycDetailView`:
  - User card (email, name)
  - **Decrypted BVN** (with copy button)
  - **Decrypted NIN** (with copy button)
  - **Selfie image** (rendered from `selfieUrl`)
  - Status + history (submitted, reviewed)
  - Rejection reason if previously rejected
- Action buttons (only when status=PENDING):
  - **Approve** (no body) → `KycApproveButton`
  - **Reject** → `KycRejectDialog` (reason required)
- 🚨 **PII WARNING BANNER**: "This page displays sensitive PII. Every view
  is logged. Do not screenshot/share."

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/kyc/:userId` | On page load (DECRYPTS BVN/NIN — logged) |
| `POST /api/proxy/kyc/:userId/approve` | Approve button |
| `POST /api/proxy/kyc/:userId/reject` | Reject dialog |

**`GET /api/proxy/kyc/:userId` 200 response (data field)** — includes
**decrypted** BVN/NIN:
```json
{
  "userId": "cmpg...",
  "email": "tunde@example.com",
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
  "selfieUrl": "https://res.cloudinary.com/xchangnow/.../selfie.jpg",
  "rejectionReason": null
}
```

⚠️ Side effect: backend writes `pii_access_logs` row with
`action: 'READ', resourceType: 'KYC_DOCUMENT', reason: 'Admin KYC review'`.
This is the most audit-worthy operation in the system. The PII warning
banner reminds the admin that they're being audited.

**`POST /api/proxy/kyc/:userId/approve`** — no body.

200 response: KYC self-view shape with `status: "APPROVED"`.

**`POST /api/proxy/kyc/:userId/reject` body**:
```json
{ "reason": "Selfie is too blurry to verify. Please retake in better lighting." }
```

200 response: KYC self-view with `status: "REJECTED"`, `rejectionReason` set.

---

### 4.10 Rates — `/admin/rates`

**Roles**: SUPER_ADMIN, ADMIN, OPS

**Components**:
- `CurrentRatesCard`: tile per asset (BTC, ETH, USDT, USDC) showing buyRate / sellRate / fetchedAt
- `RateHistoryChart` (Recharts): line chart of buyRate + sellRate over time, asset selector
- `Table` of recent rate snapshots
- "Add Snapshot" button → `/admin/rates/new`

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/rates/current` | Top tiles |
| `GET /api/proxy/rates?asset=BTC&pageSize=50` | History chart + table |

**`GET /api/proxy/rates/current` 200 response (data field)**:
```json
{
  "fiatCurrency": "NGN",
  "rates": [
    {
      "asset": "BTC",
      "buyRate": "70000000.00",
      "sellRate": "68000000.00",
      "source": "manual",
      "fetchedAt": "2026-05-28T14:30:00.000Z"
    },
    {
      "asset": "USDT",
      "buyRate": "1600.00",
      "sellRate": "1550.00",
      "source": "manual",
      "fetchedAt": "2026-05-28T14:30:00.000Z"
    }
  ]
}
```

---

### 4.11 Add rate snapshot — `/admin/rates/new`

**Roles**: SUPER_ADMIN, ADMIN, OPS

**Components**:
- `NewRateForm`: asset selector, buyRate input (decimal string), sellRate input, optional source string

**Endpoint**: `POST /api/proxy/rates`

**Body**:
```json
{
  "asset": "BTC",
  "buyRate": "70500000.00",
  "sellRate": "68500000.00",
  "fiatCurrency": "NGN",
  "source": "manual"
}
```

**201 response (data field)**:
```json
{
  "id": "cmph19915000ho850d27tijhm",
  "asset": "BTC",
  "fiatCurrency": "NGN",
  "buyRate": "70500000.00",
  "sellRate": "68500000.00",
  "source": "manual",
  "isManualOverride": true,
  "updatedById": "cmpg...",
  "fetchedAt": "2026-05-28T14:30:00.000Z"
}
```

On success: toast `"Rate snapshot recorded"`, redirect back to `/admin/rates`.

---

### 4.12 Wallets list — `/admin/wallets`

**Roles**: SUPER_ADMIN, ADMIN, OPS

**Components**:
- `WalletsTable`: asset, network, address (truncated + copy), label, isActive badge, actions
- Filter: asset, network, isActive
- "Add Wallet" button → `/admin/wallets/new`
- Click row → `/admin/wallets/:id`

**Endpoint**: `GET /api/proxy/wallets?isActive=true`

**200 response (data field)** — array (no pagination):
```json
[
  {
    "id": "cmpgx5rxg000eo85k60xgd3fr",
    "cryptoAsset": "BTC",
    "network": "BITCOIN",
    "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "label": "Primary BTC hot wallet",
    "isActive": true,
    "createdAt": "2026-05-22T12:00:00.000Z",
    "updatedAt": "2026-05-22T12:00:00.000Z"
  }
]
```

---

### 4.13 Add wallet — `/admin/wallets/new`

**Components**: `WalletForm` (create mode)

**Endpoint**: `POST /api/proxy/wallets`

**Body** — `CreateWalletDto`:
```json
{
  "cryptoAsset": "BTC",
  "network": "BITCOIN",
  "address": "bc1qxy...",
  "label": "Primary BTC hot wallet",
  "isActive": true
}
```

201 response: new wallet.

Errors:
- 409 `"Wallet address already exists for this asset/network"`

---

### 4.14 Wallet detail / edit — `/admin/wallets/:id`

**Components**: `WalletForm` (edit mode) — only label + isActive mutable. Address/asset/network display-only.

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/wallets/:id` | On page load |
| `PATCH /api/proxy/wallets/:id` | Save changes |
| `DELETE /api/proxy/wallets/:id` | Deactivate button |

**`PATCH` body**:
```json
{ "label": "BTC retired", "isActive": false }
```

**`DELETE`** — soft delete (isActive=false). 200 response with updated wallet.

---

### 4.15 Staff list — `/admin/staff`

**Roles**: SUPER_ADMIN, ADMIN

**Components**:
- `StaffTable`: email, name, **role badge**, status, lastLoginAt
- Filter: role, status
- "Invite Staff" button (SUPER_ADMIN only) → `/admin/staff/invite`
- Click row → `/admin/staff/:id`

**Endpoint**: `GET /api/proxy/admin/staff?page=1&pageSize=20`

**200 response (data field)** — same shape as `/users` list (masked phone):
```json
{
  "staff": [
    {
      "id": "cmpg...",
      "email": "ops1@xchangnow.com",
      "firstName": "Tunde",
      "lastName": "Bello",
      "phoneNumberMasked": "+234***5670",
      "role": "OPS",
      "status": "PENDING_VERIFICATION",
      "isEmailVerified": false,
      "lastLoginAt": null,
      "lastLoginIp": null,
      "createdAt": "2026-05-22T13:00:00.000Z",
      "updatedAt": "2026-05-22T13:00:00.000Z",
      "deletedAt": null
    }
  ],
  "total": 6,
  "page": 1,
  "pageSize": 20
}
```

---

### 4.16 Invite staff — `/admin/staff/invite`

**Roles**: SUPER_ADMIN only

**Components**: `InviteStaffForm` — email, firstName, lastName, role selector (ADMIN | OPS | CUSTOMER_SERVICE — NO SUPER_ADMIN option), optional phone

**Endpoint**: `POST /api/proxy/admin/staff`

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

**201 response (data field)**:
```json
{
  "user": {
    "id": "cmpg...",
    "email": "ops1@xchangnow.com",
    "firstName": "Tunde",
    "lastName": "Bello",
    "phoneNumberMasked": "+234***5670",
    "role": "OPS",
    "status": "PENDING_VERIFICATION",
    "isEmailVerified": false,
    "lastLoginAt": null,
    "lastLoginIp": null,
    "createdAt": "...",
    "updatedAt": "...",
    "deletedAt": null
  },
  "inviteToken": "a1b2c3d4..."
}
```

`inviteToken` only in dev. Production response just has the `user` field.

On success: toast `"Invite email sent to {email}"`, redirect back to `/admin/staff`.

Errors:
- 400 `"role must be one of: ADMIN, OPS, CUSTOMER_SERVICE"`
- 409 `"Email already registered"` / `"Phone number already registered"`

---

### 4.17 Staff detail / change role — `/admin/staff/:id`

**Roles**: SUPER_ADMIN (for role change) / ADMIN (read-only)

**Components**:
- Staff detail card
- Role management (SUPER_ADMIN only): `ChangeRoleDialog` with reason

**Endpoint**: `PATCH /api/proxy/admin/staff/:id/role`

**Body**:
```json
{ "role": "ADMIN", "reason": "Promoted from OPS after Q2 review" }
```

200 response: updated user (masked).

Errors:
- 400 — role=SUPER_ADMIN/USER (rejected)
- 403 — self-promotion / target is SUPER_ADMIN
- 404 — not found

---

### 4.18 Settings — `/admin/settings`

**Roles**: all admin

**Components**: `UserDetailCard` with self-edit form (firstName, lastName, phoneNumber)

**Endpoints**:

| Endpoint | When |
|---|---|
| `GET /api/proxy/users/me` | Load own profile (full — not masked) |
| `PATCH /api/proxy/users/me` | Save profile edits |

---

## 5. Shared API client (`lib/api/client.ts`)

```ts
// Pseudo-code shape

type ResponseEnvelope<T> = {
  success: true; message: string; data: T; meta: Meta;
};
type ErrorEnvelope = {
  success: false; message: string; data: null;
  error: { code: string; details: string[] };
  meta: Meta;
};
type Meta = { requestId: string; timestamp: string; durationMs?: number; path: string };

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; meta: Meta; message: string }> {
  const res = await fetch(`/api/proxy${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });

  const envelope = (await res.json()) as ResponseEnvelope<T> | ErrorEnvelope;

  if (!envelope.success) {
    throw new ApiError(envelope);  // custom error class with code, details, requestId
  }

  return {
    data: envelope.data,
    meta: envelope.meta,
    message: envelope.message,
  };
}

// On a 401 with code UNAUTHORIZED and a known message ("Session is no longer
// valid", "Invalid refresh token"), the apiFetch wrapper should attempt ONE
// silent refresh via /api/auth/refresh before re-throwing.
```

### Error handling pattern

```ts
try {
  const { data } = await apiFetch<User>(`/users/${id}`);
} catch (err) {
  if (err instanceof ApiError) {
    if (err.code === 'NOT_FOUND') {
      router.push('/admin/users');
      return;
    }
    if (err.code === 'FORBIDDEN') {
      toast.error('You do not have permission for this action');
      return;
    }
    // Generic error toast — INCLUDE requestId for support
    toast.error(err.message, {
      description: `Reference: ${err.meta.requestId}`,
    });
  }
}
```

---

## 6. Cross-cutting requirements

### 6.1 RequestId in every error toast

When a mutation fails, the toast should include `err.meta.requestId` so the
admin can quote it to engineering for log correlation. Use `sonner`'s
`description` prop.

### 6.2 Optimistic updates + invalidation

For mutations like approve/reject/status-update, use TanStack Query's
`mutate` with `onSuccess: () => queryClient.invalidateQueries(['transactions'])`.
For dashboard counts, invalidate the count queries too.

### 6.3 Role-based component rendering

```tsx
<RoleGate roles={['SUPER_ADMIN']}>
  <Button onClick={openInviteDialog}>Invite Staff</Button>
</RoleGate>
```

Backend always re-checks — `RoleGate` is purely FE affordance.

### 6.4 Money formatting

- All amounts come as decimal strings (`"290000.00"`)
- Use a `Decimal` library or just `Number()` with explicit precision
- Display as `₦290,000.00` (NG locale)
- Component: `<CurrencyDisplay amount={tx.fiatAmount} currency={tx.fiatCurrency} />`

### 6.5 Date formatting

- All dates are ISO 8601 strings
- Display: relative ("3 hours ago") + tooltip with absolute ("2026-05-28 14:30 WAT")
- Component: `<DateTimeDisplay value={tx.createdAt} />`

### 6.6 PII display rules

- Lists: show **masked** phone + bank account (per backend response)
- Detail pages: same — backend never returns full phone/bank to admins
- KYC review screen: shows DECRYPTED BVN/NIN with a banner ⚠️ "Sensitive PII
  — your view is logged"
- All actions that decrypt should require an explicit user action (no auto-
  decrypt on hover)

### 6.7 Audit visibility (for the admin's awareness)

Backend writes a `pii_access_logs` row every time an admin:
- Lists users (`PROFILE LIST`)
- Opens a user (`PROFILE READ`)
- Updates a user's status (`USER UPDATE`)
- Anonymizes a user (`PROFILE ANONYMIZE`)
- Lists KYC queue (`KYC_DOCUMENT LIST`)
- Opens a KYC submission (`KYC_DOCUMENT READ`) ← most audit-worthy
- Lists staff (`STAFF LIST`)
- Invites/role-changes staff (`STAFF CREATE/UPDATE`)

Surface this in the FE only via a "your audit trail" page (future) — but
during admin training, communicate that the audit trail exists.

---

## 7. Sequence diagrams for the two highest-frequency flows

### 7.1 Approve a SELL transaction

```
[Admin clicks Approve in /admin/transactions/:id]
   ↓ ApproveDialog opens with optional notes field
[Admin clicks Confirm]
   ↓ POST /api/proxy/transactions/:id/approve { notes: "..." }
[Proxy attaches cookie tokens, forwards to backend]
   ↓ Backend updates Transaction → APPROVED + creates PENDING Payout (atomic)
[200 response with updated transaction]
   ↓ FE shows toast: "Transaction APPROVED"
   ↓ FE invalidates queries: transactions list, transaction detail, payouts list
   ↓ FE redirects/refreshes; payout queue badge increments by 1
[Admin proceeds to /admin/payouts to process the new PENDING payout]
   ↓ Eventually marks payout PAID
   ↓ Backend cascades Transaction → COMPLETED + creates ReferralCommission
[Toast: "Payout PAID; transaction COMPLETED"]
```

### 7.2 Review KYC submission

```
[Admin opens /admin/kyc with status=PENDING]
   ↓ Sees queue, clicks oldest entry
[GET /api/proxy/kyc/:userId returns DECRYPTED bvn, nin, selfieUrl]
   ↓ Backend writes pii_access_logs READ row
[FE renders /admin/kyc/:userId with PII warning banner]
   ↓ Admin visually verifies:
     - selfie matches the firstName/lastName on Profile
     - BVN's first few digits look plausible
     - (with provider integration later: auto NIBSS lookup)
[Admin clicks Approve OR Reject]
   ↓ POST /api/proxy/kyc/:userId/approve  OR
     POST /api/proxy/kyc/:userId/reject { reason: "..." }
[Backend writes admin_log + security_log + pii_access_log UPDATE]
[FE shows toast, redirects to /admin/kyc]
```

---

## 8. Suggested build order

The dashboard is large. Build in this order so each layer unblocks the next:

1. **Auth + middleware** — login page, cookie handling, route protection, RoleGate component, current user context. Until this works, nothing else can be tested.
2. **Layout chrome** — sidebar with role-gated nav, topbar with logout, breadcrumbs. Empty pages with just titles.
3. **Shared components** — DataTable wrapper, Pagination, FilterBar, ConfirmDialog, error toast, currency/date display.
4. **Transactions flow (end-to-end vertical slice)** — list page + detail page + approve/reject. Once one full flow works, everything else is a variation.
5. **Payouts flow** — same pattern as transactions, then SELL → COMPLETED works end-to-end.
6. **Users management** — list, detail, change status, anonymize.
7. **KYC review** — queue + detail (with PII warning banner) + approve/reject.
8. **Rates** — current rates card + new snapshot form + history chart.
9. **Wallets** — CRUD.
10. **Staff management** — list + invite + change role. SUPER_ADMIN-only routes.
11. **Dashboard home KPIs** — once all the underlying queries exist.
12. **Polish** — empty states, loading skeletons, error boundaries, breadcrumbs, dark mode.

---

## 9. Recommended npm packages

| Concern | Pick | Why |
|---|---|---|
| Data fetching + cache | `@tanstack/react-query` | Cache invalidation + retry + stale-while-revalidate; perfect for an admin dashboard |
| Tables | `@tanstack/react-table` | Headless table primitives; build the UI with shadcn |
| Forms + validation | `react-hook-form` + `zod` | Industry standard; the same zod schemas can mirror backend DTOs |
| UI primitives | `shadcn/ui` + `tailwindcss` | Copy-paste components you own; no black-box dependency |
| Toasts | `sonner` | Reads the envelope's `message` + `requestId` cleanly |
| Charts | `recharts` | Rates history line chart |
| Date display | `date-fns` | Relative dates; ICU-friendly |
| Decimal display | `decimal.js` | Preserve precision on amounts |
| Icons | `lucide-react` | Pairs with shadcn |
| Modal/dialog | `@radix-ui/react-dialog` via shadcn | Accessible by default |

---

## 10. Out of scope for this spec (deferred FE work)

- Audit log viewer (`/admin/audit`) — needs new backend endpoint exposing `pii_access_logs`
- Notifications panel — needs `/notifications/me` (not built)
- Customer-facing dashboard (`/dashboard`, `/transactions`, etc.) — separate spec
- File upload widget for KYC selfie — that lives in the USER frontend, not admin
- Multi-step KYC review flow with NIBSS/NIMC verification — needs provider integration
- Referral leaderboard / fraud detection screens — needs new endpoints
- Bulk actions (approve multiple transactions) — single-row actions only for v1

---

**Last updated:** 2026-05-28. Sibling to `API_REFERENCE.md` and
`FOLDER_STRUCTURE.md`. Hand this file to the FE team.
