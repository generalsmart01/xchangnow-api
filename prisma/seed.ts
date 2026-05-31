/**
 * Bootstrap seed — creates the very first SUPER_ADMIN user.
 *
 * RUNS AUTOMATICALLY VIA `prisma db seed`. Wired in via the "prisma.seed"
 * field in package.json. Add `npx prisma db seed` to the Render build
 * command so it runs once per deploy.
 *
 * Behavior:
 *   - Reads SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD from process.env
 *   - If EITHER is unset → exit 0 with a log, no error. Lets you REMOVE the
 *     env vars from Render after first successful deploy without breaking
 *     subsequent deploys.
 *   - If a user with that email already exists → skip (idempotent).
 *     This is critical: re-running the seed with a different password must
 *     NOT silently rotate an existing admin's password. To intentionally
 *     change the password, use the forgot-password flow or change it from
 *     inside the app.
 *   - Otherwise: hash with bcrypt (using BCRYPT_ROUNDS env, default 12),
 *     insert User with role=SUPER_ADMIN, status=ACTIVE, isEmailVerified=true,
 *     and write a CRITICAL SecurityLog entry for the audit trail.
 *
 * Operational guidance:
 *   1. Set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD in Render env (use a
 *      generated 16+ char password, NOT one you'll reuse anywhere)
 *   2. Deploy → seed creates the user
 *   3. Log in with those credentials
 *   4. (Recommended) trigger /auth/forgot-password to set a new password you
 *      chose yourself, in case the env-var password is captured anywhere
 *   5. REMOVE SUPER_ADMIN_PASSWORD from Render env (the user exists now;
 *      keeping the secret in env is unnecessary risk)
 */
import {
  PrismaClient,
  RiskSeverity,
  SecurityEventType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Backfill `users.email_normalized` for any rows that predate the
 * email-normalization migration. Runs on every seed invocation; once all
 * rows are populated this is a no-op (updateCount = 0).
 *
 * Done as raw SQL because Prisma's updateMany cannot set one column from the
 * value of another column — that's a SQL expression, not a JS value.
 */
async function backfillEmailNormalized(): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE users
    SET email_normalized = LOWER(TRIM(email))
    WHERE email_normalized IS NULL
  `;
  if (updated > 0) {
    console.log(
      `[seed] Backfilled email_normalized on ${updated} user row(s).`,
    );
  }
}

/**
 * Backfill missing Profile rows for any User that predates the User/Profile
 * split. Without this, those users 500 on `PATCH /users/me` (Prisma P2025
 * "record not found" because profile.update has nothing to target).
 *
 * Default firstName/lastName are intentionally placeholders ("Account" /
 * "User") — we have no way to recover the original names since the columns
 * were dropped from User when the migration moved them to Profile. The user
 * can update them via PATCH /users/me right after this runs.
 */
async function backfillMissingProfiles(): Promise<void> {
  const missing = await prisma.user.findMany({
    where: { profile: null },
    select: { id: true, email: true },
  });
  if (missing.length === 0) return;

  for (const u of missing) {
    await prisma.profile.create({
      data: {
        userId: u.id,
        firstName: 'Account',
        lastName: 'User',
      },
    });
  }
  console.log(`[seed] Backfilled profile on ${missing.length} user row(s).`);
}

/**
 * Backfill `users.referral_code` for any pre-migration rows. We generate
 * codes in a tight loop using Prisma updates (one per row) rather than raw
 * SQL — the @unique constraint means we need to detect+retry on collisions,
 * which is awkward in raw SQL. Slow on huge tables but adequate for seed
 * scenarios (≪ 1k rows).
 */
async function backfillReferralCodes(): Promise<void> {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const missing = await prisma.user.findMany({
    where: { referralCode: null },
    select: { id: true },
  });
  if (missing.length === 0) return;

  let updated = 0;
  for (const row of missing) {
    // Retry up to 5 times on the (vanishingly rare) collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      let suffix = '';
      for (let i = 0; i < 6; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const code = `XCN-${suffix}`;
      try {
        await prisma.user.update({
          where: { id: row.id },
          data: { referralCode: code },
        });
        updated++;
        break;
      } catch {
        // Most likely P2002 (collision); loop and try a new code. Any other
        // error will surface on the final attempt.
        if (attempt === 4) throw new Error(`[seed] Failed to generate unique referral code for user ${row.id}`);
      }
    }
  }
  console.log(`[seed] Backfilled referral_code on ${updated} user row(s).`);
}

async function ensureCoreAssetsAndNetworks(): Promise<void> {
  // Idempotent seeder for the dynamic Asset / Network / AssetNetwork tables.
  // Replaces the old CryptoAsset / CryptoNetwork enums. Safe to re-run.
  //
  // Networks first (parents), then Assets (parents), then AssetNetwork pairs
  // (which reference both). Uses upsert keyed on the natural unique columns
  // (`code` for Network, `symbol` for Asset, `assetId_networkId` for the pair).

  const networkSeed: Array<{
    code: string;
    name: string;
    chainId: number | null;
    explorerUrlTemplate: string | null;
    nativeAssetSymbol: string | null;
    sortOrder: number;
  }> = [
    { code: 'BITCOIN', name: 'Bitcoin', chainId: null, explorerUrlTemplate: 'https://blockstream.info/tx/{txHash}', nativeAssetSymbol: 'BTC', sortOrder: 10 },
    { code: 'ETHEREUM', name: 'Ethereum', chainId: 1, explorerUrlTemplate: 'https://etherscan.io/tx/{txHash}', nativeAssetSymbol: 'ETH', sortOrder: 20 },
    { code: 'TRON', name: 'Tron', chainId: null, explorerUrlTemplate: 'https://tronscan.org/#/transaction/{txHash}', nativeAssetSymbol: 'TRX', sortOrder: 30 },
    { code: 'BSC', name: 'BNB Smart Chain', chainId: 56, explorerUrlTemplate: 'https://bscscan.com/tx/{txHash}', nativeAssetSymbol: 'BNB', sortOrder: 40 },
    { code: 'POLYGON', name: 'Polygon', chainId: 137, explorerUrlTemplate: 'https://polygonscan.com/tx/{txHash}', nativeAssetSymbol: 'MATIC', sortOrder: 50 },
    { code: 'SOLANA', name: 'Solana', chainId: null, explorerUrlTemplate: 'https://solscan.io/tx/{txHash}', nativeAssetSymbol: 'SOL', sortOrder: 60 },
  ];
  for (const n of networkSeed) {
    await prisma.network.upsert({
      where: { code: n.code },
      update: {}, // don't overwrite admin edits to existing rows
      create: n,
    });
  }

  const assetSeed: Array<{ symbol: string; name: string; decimals: number; sortOrder: number }> = [
    { symbol: 'BTC', name: 'Bitcoin', decimals: 8, sortOrder: 10 },
    { symbol: 'ETH', name: 'Ethereum', decimals: 18, sortOrder: 20 },
    { symbol: 'USDT', name: 'Tether USD', decimals: 6, sortOrder: 30 },
    { symbol: 'USDC', name: 'USD Coin', decimals: 6, sortOrder: 40 },
    { symbol: 'BNB', name: 'BNB', decimals: 18, sortOrder: 50 },
    { symbol: 'MATIC', name: 'Polygon', decimals: 18, sortOrder: 60 },
    { symbol: 'TRX', name: 'Tron', decimals: 6, sortOrder: 70 },
    { symbol: 'SOL', name: 'Solana', decimals: 9, sortOrder: 80 },
    { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, sortOrder: 90 },
    { symbol: 'SHIB', name: 'Shiba Inu', decimals: 18, sortOrder: 100 },
  ];
  for (const a of assetSeed) {
    await prisma.asset.upsert({
      where: { symbol: a.symbol },
      update: {},
      create: a,
    });
  }

  // The valid (asset, network) combinations currently in use. To add SOL,
  // ARB, etc. post-seed, admins use POST /admin/assets and POST /admin/networks
  // — this list is just the starter set the legacy enums covered.
  const pairs: Array<{ assetSymbol: string; networkCode: string; confirmationsRequired: number; contractAddress?: string }> = [
    // Originals
    { assetSymbol: 'BTC', networkCode: 'BITCOIN', confirmationsRequired: 3 },
    { assetSymbol: 'ETH', networkCode: 'ETHEREUM', confirmationsRequired: 12 },
    { assetSymbol: 'USDT', networkCode: 'ETHEREUM', confirmationsRequired: 12, contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    { assetSymbol: 'USDT', networkCode: 'TRON', confirmationsRequired: 19, contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
    { assetSymbol: 'USDT', networkCode: 'BSC', confirmationsRequired: 15, contractAddress: '0x55d398326f99059fF775485246999027B3197955' },
    { assetSymbol: 'USDT', networkCode: 'POLYGON', confirmationsRequired: 30, contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
    { assetSymbol: 'USDC', networkCode: 'ETHEREUM', confirmationsRequired: 12, contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    { assetSymbol: 'USDC', networkCode: 'POLYGON', confirmationsRequired: 30, contractAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },

    // New: native L1 coins on their own chains
    { assetSymbol: 'BNB',   networkCode: 'BSC',     confirmationsRequired: 15 },
    { assetSymbol: 'MATIC', networkCode: 'POLYGON', confirmationsRequired: 30 },
    { assetSymbol: 'TRX',   networkCode: 'TRON',    confirmationsRequired: 19 },
    { assetSymbol: 'SOL',   networkCode: 'SOLANA',  confirmationsRequired: 32 },

    // New: DAI stablecoin on multiple chains
    { assetSymbol: 'DAI', networkCode: 'ETHEREUM', confirmationsRequired: 12, contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
    { assetSymbol: 'DAI', networkCode: 'POLYGON',  confirmationsRequired: 30, contractAddress: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063' },
    { assetSymbol: 'DAI', networkCode: 'BSC',      confirmationsRequired: 15, contractAddress: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3' },

    // New: SHIB (ERC-20 only)
    { assetSymbol: 'SHIB', networkCode: 'ETHEREUM', confirmationsRequired: 12, contractAddress: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
  ];
  for (const p of pairs) {
    const asset = await prisma.asset.findUnique({ where: { symbol: p.assetSymbol } });
    const network = await prisma.network.findUnique({ where: { code: p.networkCode } });
    if (!asset || !network) continue;
    await prisma.assetNetwork.upsert({
      where: { assetId_networkId: { assetId: asset.id, networkId: network.id } },
      update: {},
      create: {
        assetId: asset.id,
        networkId: network.id,
        contractAddress: p.contractAddress,
        confirmationsRequired: p.confirmationsRequired,
      },
    });
  }

  console.log(
    `[seed] Ensured ${networkSeed.length} network(s), ${assetSeed.length} asset(s), ${pairs.length} asset-network pair(s).`,
  );
}

async function main() {
  // Always backfill first. The SUPER_ADMIN bootstrap below looks up the user
  // by emailNormalized, so any pre-existing rows must have it populated.
  await backfillEmailNormalized();
  await backfillReferralCodes();
  await backfillMissingProfiles();
  await ensureCoreAssetsAndNetworks();

  const rawEmail = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!rawEmail || !password) {
    console.log(
      '[seed] SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not set — skipping ' +
        'SUPER_ADMIN bootstrap. (This is expected after the first successful ' +
        'deploy once you remove the env vars.)',
    );
    return;
  }

  // Defence-in-depth: env validator already enforces min(12), but if the seed
  // is run via `prisma db seed` directly (bypassing Nest bootstrap), validation
  // hasn't run. Re-check here so a weak password never lands in the DB.
  if (password.length < 12) {
    throw new Error(
      `[seed] SUPER_ADMIN_PASSWORD too short (${password.length} chars). ` +
        'Required: 12+ characters.',
    );
  }

  // Dual-write email: raw (display) + normalized (lookup/uniqueness).
  // Inline the normalization rather than importing the utility to keep
  // seed.ts dependency-free — it runs outside the Nest module graph.
  const emailNormalized = rawEmail.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { emailNormalized } });
  if (existing) {
    console.log(
      `[seed] User ${emailNormalized} already exists (role=${existing.role}). ` +
        'Skipping. To change the password, use /auth/forgot-password.',
    );
    return;
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const passwordHash = await bcrypt.hash(password, rounds);

  // First/last name fall back to "Super" "Admin" — bootstrap user can update
  // these via PATCH /users/me after first login. Phone left null (optional
  // and unique, so we'd risk a conflict by guessing).
  //
  // User + Profile are created together via Prisma's nested-write. They live
  // in separate tables (PII isolation) but the API surface flattens them
  // back into one shape.
  //
  // Referral code generated inline (seed runs outside the Nest module graph
  // and we keep it dependency-free). Format mirrors generate-referral-code.ts.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let codeSuffix = '';
  for (let i = 0; i < 6; i++) {
    codeSuffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const referralCode = `XCN-${codeSuffix}`;

  const user = await prisma.user.create({
    data: {
      email: rawEmail,
      emailNormalized,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      isEmailVerified: true, // admin doesn't need to verify themselves
      referralCode,
      profile: {
        create: {
          firstName: 'Super',
          lastName: 'Admin',
        },
      },
    },
  });

  // Audit row. SecurityEventType doesn't have a dedicated bootstrap event,
  // so ADMIN_OVERRIDE + descriptive metadata is the closest fit. CRITICAL
  // severity so this stands out in any future log review.
  await prisma.securityLog.create({
    data: {
      userId: user.id,
      eventType: SecurityEventType.ADMIN_OVERRIDE,
      severity: RiskSeverity.CRITICAL,
      metadata: {
        action: 'BOOTSTRAP_SUPER_ADMIN_CREATED',
        seedRunAt: new Date().toISOString(),
        note: 'Created via prisma/seed.ts using SUPER_ADMIN_EMAIL/PASSWORD env vars',
      },
    },
  });

  console.log(
    `[seed] SUPER_ADMIN created: id=${user.id} email=${user.email}. ` +
      'You can now log in via POST /api/auth/login.',
  );
  console.log(
    '[seed] REMINDER: remove SUPER_ADMIN_PASSWORD from your environment now ' +
      'that the user exists.',
  );
}

main()
  .catch((err) => {
    console.error('[seed] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
