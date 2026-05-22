import { Injectable, NotFoundException } from '@nestjs/common';
import { CryptoAsset, ExchangeRate, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateRateDto } from './dto/create-rate.dto';
import { ListRatesQueryDto } from './dto/list-rates-query.dto';
import { UpdateRateDto } from './dto/update-rate.dto';

const SUPPORTED_ASSETS: CryptoAsset[] = ['BTC', 'ETH', 'USDT', 'USDC'];

/**
 * Rates are stored as time-series snapshots. We INSERT new rows rather than
 * mutating existing ones — that preserves history and lets us audit price
 * changes. Reads pick the most recent row for the given asset / fiat pair.
 */
@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateRateDto): Promise<ExchangeRate> {
    return this.prisma.exchangeRate.create({
      data: {
        asset: dto.asset,
        fiatCurrency: dto.fiatCurrency ?? 'NGN',
        buyRate: new Prisma.Decimal(dto.buyRate),
        sellRate: new Prisma.Decimal(dto.sellRate),
        source: dto.source ?? 'manual',
        // 'manual' is shorthand for "an admin typed this in" — set the override flag.
        isManualOverride: !dto.source || dto.source === 'manual',
        updatedById: adminId,
      },
    });
  }

  async list(query: ListRatesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ExchangeRateWhereInput = {
      ...(query.asset ? { asset: query.asset } : {}),
      ...(query.fiatCurrency ? { fiatCurrency: query.fiatCurrency } : {}),
    };

    const [rates, total] = await Promise.all([
      this.prisma.exchangeRate.findMany({
        where,
        orderBy: { fetchedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.exchangeRate.count({ where }),
    ]);

    return { rates, total, page, pageSize };
  }

  /**
   * Returns the most recent rate per supported asset for the given fiat.
   * Missing assets (no row ever recorded) are simply omitted from the result.
   */
  async current(fiatCurrency = 'NGN') {
    const rows = await Promise.all(
      SUPPORTED_ASSETS.map((asset) =>
        this.prisma.exchangeRate.findFirst({
          where: { asset, fiatCurrency },
          orderBy: { fetchedAt: 'desc' },
        }),
      ),
    );

    return {
      fiatCurrency,
      rates: rows
        .filter((r): r is ExchangeRate => r !== null)
        .map((r) => ({
          asset: r.asset,
          buyRate: r.buyRate,
          sellRate: r.sellRate,
          source: r.source,
          fetchedAt: r.fetchedAt,
        })),
    };
  }

  async findById(id: string): Promise<ExchangeRate> {
    const rate = await this.prisma.exchangeRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundException('Rate not found');
    return rate;
  }

  async update(
    adminId: string,
    id: string,
    dto: UpdateRateDto,
  ): Promise<ExchangeRate> {
    await this.findById(id); // 404 check
    return this.prisma.exchangeRate.update({
      where: { id },
      data: {
        buyRate: dto.buyRate ? new Prisma.Decimal(dto.buyRate) : undefined,
        sellRate: dto.sellRate ? new Prisma.Decimal(dto.sellRate) : undefined,
        source: dto.source,
        updatedById: adminId,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.exchangeRate.delete({ where: { id } });
  }
}
