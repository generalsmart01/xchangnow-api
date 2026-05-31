// src/modules/rates/rates.service.ts

/**
 * RatesService — append-only price book.
 *
 * Rates are stored as time-series snapshots, NEVER mutated in place. This
 * preserves price history (essential for audit + dispute resolution: "what
 * rate did this user actually see when they hit Sell?") and avoids the
 * race conditions of in-place updates.
 *
 * Rates are per-ASSET (not per-AssetNetwork) — see ExchangeRate model
 * comment. The supported asset list is dynamic (sourced from the `assets`
 * table via AssetsService) instead of a hardcoded enum, so admins can add
 * new coins without redeploying.
 *
 * Public surface:
 *   - current()      latest snapshot per enabled asset for a given fiat
 *   - create()       admin: append a new snapshot
 *   - list()         admin: paginated history
 *   - findById()     admin: one snapshot
 *   - update()       admin: edit a snapshot (typo fix; asset/currency immutable)
 *   - delete()       admin: hard delete; /current falls through to next-recent
 *
 * The `update` method exists for fixing obvious typos on a recent row. For
 * deliberate rate changes, always POST a new snapshot — preserves the audit
 * trail of "rate was X at time T".
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { CreateRateDto } from './dto/create-rate.dto';
import { ListRatesQueryDto } from './dto/list-rates-query.dto';
import { UpdateRateDto } from './dto/update-rate.dto';

const RATE_INCLUDE = {
  asset: { select: { id: true, symbol: true, name: true, decimals: true, iconUrl: true } },
} as const;

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
  ) {}

  async create(adminId: string, dto: CreateRateDto) {
    // Validate the assetId references an existing asset (404 maps to 400 — bad input).
    try {
      await this.assets.findById(dto.assetId);
    } catch {
      throw new BadRequestException(`assetId "${dto.assetId}" does not exist`);
    }

    return this.prisma.exchangeRate.create({
      data: {
        assetId: dto.assetId,
        fiatCurrency: dto.fiatCurrency ?? 'NGN',
        buyRate: new Prisma.Decimal(dto.buyRate),
        sellRate: new Prisma.Decimal(dto.sellRate),
        source: dto.source ?? 'manual',
        // 'manual' is shorthand for "an admin typed this in" — set the override flag.
        isManualOverride: !dto.source || dto.source === 'manual',
        updatedById: adminId,
      },
      include: RATE_INCLUDE,
    });
  }

  async list(query: ListRatesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ExchangeRateWhereInput = {
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.fiatCurrency ? { fiatCurrency: query.fiatCurrency } : {}),
    };

    const [rates, total] = await Promise.all([
      this.prisma.exchangeRate.findMany({
        where,
        orderBy: { fetchedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: RATE_INCLUDE,
      }),
      this.prisma.exchangeRate.count({ where }),
    ]);

    return { rates, total, page, pageSize };
  }

  /**
   * Returns the most recent rate per ENABLED asset for the given fiat.
   * Missing assets (no row ever recorded) are simply omitted from the result.
   *
   * The asset list comes from AssetsService (cached) — dynamic, no hardcoded
   * enum. New coins added via /admin/assets show up here automatically once
   * an admin POSTs their first rate snapshot.
   */
  async current(fiatCurrency = 'NGN') {
    const enabledAssets = await this.assets.listEnabled();

    const rows = await Promise.all(
      enabledAssets.map((asset) =>
        this.prisma.exchangeRate.findFirst({
          where: { assetId: asset.id, fiatCurrency },
          orderBy: { fetchedAt: 'desc' },
          include: RATE_INCLUDE,
        }),
      ),
    );

    return {
      fiatCurrency,
      rates: rows
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ({
          asset: r.asset, // { id, symbol, name, decimals, iconUrl }
          buyRate: r.buyRate,
          sellRate: r.sellRate,
          source: r.source,
          fetchedAt: r.fetchedAt,
        })),
    };
  }

  async findById(id: string) {
    const rate = await this.prisma.exchangeRate.findUnique({
      where: { id },
      include: RATE_INCLUDE,
    });
    if (!rate) throw new NotFoundException('Rate not found');
    return rate;
  }

  async update(adminId: string, id: string, dto: UpdateRateDto) {
    await this.findById(id); // 404 check
    return this.prisma.exchangeRate.update({
      where: { id },
      data: {
        buyRate: dto.buyRate ? new Prisma.Decimal(dto.buyRate) : undefined,
        sellRate: dto.sellRate ? new Prisma.Decimal(dto.sellRate) : undefined,
        source: dto.source,
        updatedById: adminId,
      },
      include: RATE_INCLUDE,
    });
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.exchangeRate.delete({ where: { id } });
  }
}
