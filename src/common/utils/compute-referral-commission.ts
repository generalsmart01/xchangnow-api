// src/common/utils/compute-referral-commission.ts

/**
 * Computes the referral commission row to insert when a transaction reaches
 * COMPLETED. Pure function — returns the data, the caller does the insert
 * inside their own `$transaction` so the commission write is atomic with the
 * COMPLETED transition that triggered it.
 *
 * Commission rules (v1):
 *   - Rate: 0.1% of `fiatAmount`
 *   - Applies to BUY and SELL only (SWAP has no clean NGN basis; revisit
 *     when RatesService exposes a `convertToFiat()` helper at completion
 *     time)
 *   - Skipped if the trader has no referrer (`referredById` is null)
 *   - Skipped if `fiatAmount` is null (defensive — should never happen for
 *     BUY/SELL that reached COMPLETED)
 *
 * Returning `null` is the "no commission applies" signal. The caller just
 * skips the insert.
 *
 * The commission row's `ratePercent` is stored alongside `basisAmount` so
 * historical rows remain interpretable even if the rate changes later — a
 * 0.05% row created in 2027 sits next to 0.1% rows from 2026 and the audit
 * trail is unambiguous.
 */

import { Prisma, TransactionType } from '@prisma/client';

export const REFERRAL_COMMISSION_RATE = new Prisma.Decimal('0.001'); // 0.1%

export interface CommissionInputs {
  transactionId: string;
  refereeId: string;
  refereeReferredById: string | null;
  transactionType: TransactionType;
  fiatAmount: Prisma.Decimal | null;
}

export interface CommissionData {
  referrerId: string;
  refereeId: string;
  transactionId: string;
  amount: Prisma.Decimal;
  basisAmount: Prisma.Decimal;
  basisCurrency: string;
  ratePercent: Prisma.Decimal;
}

export function computeReferralCommission(
  inputs: CommissionInputs,
): CommissionData | null {
  // No referrer → nothing to credit
  if (!inputs.refereeReferredById) return null;
  // SWAP skipped — no fiat basis (revisit when rate-lookup helper exists)
  if (inputs.transactionType === TransactionType.SWAP) return null;
  // Defensive: BUY/SELL should always have a fiat amount by completion
  if (!inputs.fiatAmount) return null;

  return {
    referrerId: inputs.refereeReferredById,
    refereeId: inputs.refereeId,
    transactionId: inputs.transactionId,
    amount: inputs.fiatAmount.mul(REFERRAL_COMMISSION_RATE),
    basisAmount: inputs.fiatAmount,
    basisCurrency: 'NGN',
    ratePercent: REFERRAL_COMMISSION_RATE,
  };
}
