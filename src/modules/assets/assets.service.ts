// src/modules/assets/assets.service.ts

/**
 * AssetsService — CRUD over the dynamic Asset reference table + management
 * of the AssetNetwork pair config (per-chain settings for each coin).
 *
 * Public surface:
 *   - listEnabled()           public — cached enabled assets with networks
 *   - findById(id)            public — single asset with networks
 *   - findBySymbol(symbol)    public — lookup by ticker
 *
 * Admin surface:
 *   - listAll(query)          paginated admin list (incl. disabled)
 *   - create(dto)             create asset + optional initial pairs (one txn)
 *   - update(id, dto)         mutable fields only (NOT symbol, NOT decimals)
 *   - setEnabled(id, bool)    convenience toggle
 *   - delete(id)              hard delete; 409 if pairs/transactions exist
 *
 * Pair surface (per-asset):
 *   - addNetwork(assetId, dto)         add one AssetNetwork to an existing asset
 *   - updatePair(pairId, dto)          update pair-specific config
 *   - removePair(pairId)               delete a pair; 409 if referenced by tx
 *
 * Caching: 60s in-process TTL on listEnabled. Invalidated on EVERY admin
 * write (create/update/setEnabled/delete/addNetwork/updatePair/removePair).
 * See [[project-redis-plan]] for the post-Contabo migration to Redis-backed
 * cache.
 *
 * Immutability rules (enforced by DTO shape + service guards):
 *   - Asset.symbol   — set at create, never changed
 *   - Asset.decimals — set at create, never changed (would corrupt history)
 *   - AssetNetwork.networkId — set at create, never changed (delete + recreate)
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Asset, AssetNetwork, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AssetNetworkInputDto } from './dto/asset-network-input.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetNetworkDto } from './dto/update-asset-network.dto';

const CACHE_TTL_MS = 60_000;

type AssetWithNetworks = Prisma.AssetGetPayload<{
  include: { networks: { include: { network: true } } };
}>;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private enabledCache: { value: AssetWithNetworks[]; loadedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------- public read -----------------------------

  async listEnabled(): Promise<AssetWithNetworks[]> {
    if (
      this.enabledCache &&
      Date.now() - this.enabledCache.loadedAt < CACHE_TTL_MS
    ) {
      return this.enabledCache.value;
    }
    const value = await this.prisma.asset.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }],
      include: {
        networks: {
          where: { isEnabled: true },
          include: { network: true },
        },
      },
    });
    this.enabledCache = { value, loadedAt: Date.now() };
    return value;
  }

  async findById(id: string): Promise<AssetWithNetworks> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { networks: { include: { network: true } } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async findBySymbol(symbol: string): Promise<AssetWithNetworks> {
    const asset = await this.prisma.asset.findUnique({
      where: { symbol: symbol.toUpperCase() },
      include: { networks: { include: { network: true } } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  // -------------------------------- admin --------------------------------

  async listAll(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [assets, total] = await Promise.all([
      this.prisma.asset.findMany({
        orderBy: [{ sortOrder: 'asc' }, { symbol: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { networks: { include: { network: true } } },
      }),
      this.prisma.asset.count(),
    ]);
    return { assets, total, page, pageSize };
  }

  async create(adminId: string, dto: CreateAssetDto): Promise<AssetWithNetworks> {
    if (dto.networks?.length) {
      await this.validateNetworkPairs(dto.networks);
    }

    try {
      const asset = await this.prisma.asset.create({
        data: {
          symbol: dto.symbol.toUpperCase(),
          name: dto.name,
          decimals: dto.decimals,
          iconUrl: dto.iconUrl,
          isEnabled: dto.isEnabled ?? true,
          sortOrder: dto.sortOrder ?? 0,
          ...(dto.networks?.length && {
            networks: {
              create: dto.networks.map((n) => this.toCreatePairData(n)),
            },
          }),
        },
        include: { networks: { include: { network: true } } },
      });
      this.invalidateCache();
      this.logger.log(
        `Asset created: ${asset.symbol} (id=${asset.id}) with ${asset.networks.length} network(s) by admin=${adminId}`,
      );
      return asset;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new ConflictException(
            `An asset with symbol "${dto.symbol.toUpperCase()}" already exists`,
          );
        }
        if (err.code === 'P2003') {
          throw new BadRequestException('One of the provided networkIds does not exist');
        }
      }
      throw err;
    }
  }

  async update(adminId: string, id: string, dto: UpdateAssetDto): Promise<AssetWithNetworks> {
    await this.findById(id);
    const asset = await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.iconUrl !== undefined && { iconUrl: dto.iconUrl }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
      include: { networks: { include: { network: true } } },
    });
    this.invalidateCache();
    this.logger.log(`Asset updated: ${asset.symbol} (id=${id}) by admin=${adminId}`);
    return asset;
  }

  async setEnabled(adminId: string, id: string, enabled: boolean): Promise<AssetWithNetworks> {
    return this.update(adminId, id, { isEnabled: enabled });
  }

  async delete(adminId: string, id: string): Promise<void> {
    await this.findById(id);
    try {
      await this.prisma.asset.delete({ where: { id } });
      this.invalidateCache();
      this.logger.log(`Asset deleted: id=${id} by admin=${adminId}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete an asset with attached networks or historical transactions. Disable it instead.',
        );
      }
      throw err;
    }
  }

  // ------------------------- per-asset pair API --------------------------

  async addNetwork(
    adminId: string,
    assetId: string,
    dto: AssetNetworkInputDto,
  ): Promise<AssetNetwork> {
    await this.findById(assetId);
    await this.validateNetworkPairs([dto]);

    try {
      const pair = await this.prisma.assetNetwork.create({
        data: {
          assetId,
          networkId: dto.networkId,
          contractAddress: dto.contractAddress,
          decimals: dto.decimals,
          ...(dto.minDeposit && { minDeposit: new Prisma.Decimal(dto.minDeposit) }),
          ...(dto.minWithdrawal && { minWithdrawal: new Prisma.Decimal(dto.minWithdrawal) }),
          ...(dto.withdrawalFee && { withdrawalFee: new Prisma.Decimal(dto.withdrawalFee) }),
          confirmationsRequired: dto.confirmationsRequired ?? 1,
          isEnabled: dto.isEnabled ?? true,
        },
        include: { asset: true, network: true },
      });
      this.invalidateCache();
      this.logger.log(
        `AssetNetwork pair created: asset=${assetId} network=${dto.networkId} (id=${pair.id}) by admin=${adminId}`,
      );
      return pair;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This asset is already configured for this network. Update the existing pair instead.',
        );
      }
      throw err;
    }
  }

  async updatePair(
    adminId: string,
    pairId: string,
    dto: UpdateAssetNetworkDto,
  ): Promise<AssetNetwork> {
    const existing = await this.prisma.assetNetwork.findUnique({ where: { id: pairId } });
    if (!existing) throw new NotFoundException('Asset-network pair not found');

    const pair = await this.prisma.assetNetwork.update({
      where: { id: pairId },
      data: {
        ...(dto.contractAddress !== undefined && { contractAddress: dto.contractAddress }),
        ...(dto.decimals !== undefined && { decimals: dto.decimals }),
        ...(dto.minDeposit !== undefined && { minDeposit: new Prisma.Decimal(dto.minDeposit) }),
        ...(dto.minWithdrawal !== undefined && { minWithdrawal: new Prisma.Decimal(dto.minWithdrawal) }),
        ...(dto.withdrawalFee !== undefined && { withdrawalFee: new Prisma.Decimal(dto.withdrawalFee) }),
        ...(dto.confirmationsRequired !== undefined && {
          confirmationsRequired: dto.confirmationsRequired,
        }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
      },
      include: { asset: true, network: true },
    });
    this.invalidateCache();
    this.logger.log(`AssetNetwork pair updated: id=${pairId} by admin=${adminId}`);
    return pair;
  }

  async removePair(adminId: string, pairId: string): Promise<void> {
    const existing = await this.prisma.assetNetwork.findUnique({ where: { id: pairId } });
    if (!existing) throw new NotFoundException('Asset-network pair not found');

    try {
      await this.prisma.assetNetwork.delete({ where: { id: pairId } });
      this.invalidateCache();
      this.logger.log(`AssetNetwork pair deleted: id=${pairId} by admin=${adminId}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete a pair referenced by transactions or wallet addresses. Disable it instead.',
        );
      }
      throw err;
    }
  }

  // ------------------------------ internal -------------------------------

  private async validateNetworkPairs(pairs: AssetNetworkInputDto[]): Promise<void> {
    const ids = pairs.map((p) => p.networkId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new BadRequestException('Duplicate networkId in networks array');
    }
    const found = await this.prisma.network.findMany({
      where: { id: { in: [...uniqueIds] } },
      select: { id: true, isEnabled: true },
    });
    if (found.length !== uniqueIds.size) {
      throw new BadRequestException('One or more networkIds do not exist');
    }
    const disabled = found.filter((n) => !n.isEnabled);
    if (disabled.length) {
      throw new BadRequestException(
        `Cannot attach to disabled networks: ${disabled.map((n) => n.id).join(', ')}`,
      );
    }
  }

  private toCreatePairData(dto: AssetNetworkInputDto): Prisma.AssetNetworkCreateWithoutAssetInput {
    return {
      network: { connect: { id: dto.networkId } },
      contractAddress: dto.contractAddress,
      decimals: dto.decimals,
      ...(dto.minDeposit && { minDeposit: new Prisma.Decimal(dto.minDeposit) }),
      ...(dto.minWithdrawal && { minWithdrawal: new Prisma.Decimal(dto.minWithdrawal) }),
      ...(dto.withdrawalFee && { withdrawalFee: new Prisma.Decimal(dto.withdrawalFee) }),
      confirmationsRequired: dto.confirmationsRequired ?? 1,
      isEnabled: dto.isEnabled ?? true,
    };
  }

  private invalidateCache(): void {
    this.enabledCache = null;
  }
}
