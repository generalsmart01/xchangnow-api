// src/modules/networks/networks.service.ts

/**
 * NetworksService — CRUD over the `Network` reference table.
 *
 * Networks represent blockchains (BITCOIN, ETHEREUM, TRON, SOLANA, etc.).
 * Admins create them once, then attach assets to them via AssetNetwork
 * (see AssetsService.addNetwork).
 *
 * Reads are cached in-process for 60s (TTL_MS) — these rows change rarely
 * and are touched on nearly every transaction / wallet read. In-process
 * cache is sufficient given a single-instance deploy on Contabo; if/when
 * we scale horizontally, swap to Redis (see project_redis_plan memory).
 *
 * `code` is immutable post-create — enforced at service layer by ignoring
 * it from the update DTO.
 */

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Network, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateNetworkDto } from './dto/create-network.dto';
import { UpdateNetworkDto } from './dto/update-network.dto';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class NetworksService {
  private readonly logger = new Logger(NetworksService.name);
  private enabledCache: { value: Network[]; loadedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------- public read -----------------------------

  /** Enabled networks, cached. Used by frontend coin/network pickers. */
  async listEnabled(): Promise<Network[]> {
    if (
      this.enabledCache &&
      Date.now() - this.enabledCache.loadedAt < CACHE_TTL_MS
    ) {
      return this.enabledCache.value;
    }
    const value = await this.prisma.network.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    this.enabledCache = { value, loadedAt: Date.now() };
    return value;
  }

  async findById(id: string): Promise<Network> {
    const network = await this.prisma.network.findUnique({ where: { id } });
    if (!network) throw new NotFoundException('Network not found');
    return network;
  }

  async findByCode(code: string): Promise<Network> {
    const network = await this.prisma.network.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!network) throw new NotFoundException('Network not found');
    return network;
  }

  // -------------------------------- admin --------------------------------

  async listAll(query: { page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [networks, total] = await Promise.all([
      this.prisma.network.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.network.count(),
    ]);
    return { networks, total, page, pageSize };
  }

  async create(adminId: string, dto: CreateNetworkDto): Promise<Network> {
    try {
      const network = await this.prisma.network.create({
        data: {
          code: dto.code.toUpperCase(),
          name: dto.name,
          chainId: dto.chainId,
          explorerUrlTemplate: dto.explorerUrlTemplate,
          nativeAssetSymbol: dto.nativeAssetSymbol?.toUpperCase(),
          isEnabled: dto.isEnabled ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      this.invalidateCache();
      this.logger.log(`Network created: ${network.code} (id=${network.id}) by admin=${adminId}`);
      return network;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Network with code "${dto.code.toUpperCase()}" already exists`);
      }
      throw err;
    }
  }

  async update(adminId: string, id: string, dto: UpdateNetworkDto): Promise<Network> {
    await this.findById(id);
    const network = await this.prisma.network.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.chainId !== undefined && { chainId: dto.chainId }),
        ...(dto.explorerUrlTemplate !== undefined && {
          explorerUrlTemplate: dto.explorerUrlTemplate,
        }),
        ...(dto.nativeAssetSymbol !== undefined && {
          nativeAssetSymbol: dto.nativeAssetSymbol.toUpperCase(),
        }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
    this.invalidateCache();
    this.logger.log(`Network updated: ${network.code} (id=${id}) by admin=${adminId}`);
    return network;
  }

  async setEnabled(adminId: string, id: string, enabled: boolean): Promise<Network> {
    return this.update(adminId, id, { isEnabled: enabled });
  }

  async delete(adminId: string, id: string): Promise<void> {
    await this.findById(id);
    try {
      await this.prisma.network.delete({ where: { id } });
      this.invalidateCache();
      this.logger.log(`Network deleted: id=${id} by admin=${adminId}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete a network with attached assets. Disable it instead, or remove the asset-network pairs first.',
        );
      }
      throw err;
    }
  }

  private invalidateCache(): void {
    this.enabledCache = null;
  }
}
