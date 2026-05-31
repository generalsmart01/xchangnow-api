// src/modules/wallets/wallets.service.ts

/**
 * WalletsService — owns the company wallet address pool.
 *
 * Each wallet references a single AssetNetwork pair (the asset × network
 * combination). One FK guarantees the combination is valid by construction
 * — no possibility of registering a Bitcoin address against Ethereum.
 *
 * Public surface:
 *   - create / list / findById / update / deactivate   (admin CRUD)
 *   - pickActiveWallet(assetNetworkId)
 *                         called by TransactionsService at SELL/SWAP
 *                         creation. Selects any active wallet for the pair.
 *                         Throws if none available — SELL/SWAP refused.
 *
 * Delete is intentionally a SOFT delete (sets isActive=false) — historical
 * transactions reference wallets by id, and hard deletion would orphan them.
 * To "remove" a wallet, deactivate it; recreate to restore.
 *
 * Uniqueness on (assetNetworkId, address) — same address on different
 * networks (e.g. an EVM address that's the same on Ethereum + Polygon) is
 * allowed because the assetNetworkId differs.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';

const WALLET_INCLUDE = {
  assetNetwork: {
    include: {
      asset: { select: { id: true, symbol: true, name: true, decimals: true, iconUrl: true } },
      network: { select: { id: true, code: true, name: true, chainId: true } },
    },
  },
} as const;

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWalletDto) {
    await this.assertPairExistsAndEnabled(dto.assetNetworkId);

    try {
      return await this.prisma.walletAddress.create({
        data: {
          assetNetworkId: dto.assetNetworkId,
          address: dto.address,
          label: dto.label,
          isActive: dto.isActive ?? true,
        },
        include: WALLET_INCLUDE,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Wallet address already registered for this asset-network pair',
        );
      }
      throw err;
    }
  }

  list(query: ListWalletsQueryDto) {
    const where: Prisma.WalletAddressWhereInput = {
      ...(query.assetNetworkId ? { assetNetworkId: query.assetNetworkId } : {}),
      ...(query.assetId || query.networkId
        ? {
            assetNetwork: {
              ...(query.assetId && { assetId: query.assetId }),
              ...(query.networkId && { networkId: query.networkId }),
            },
          }
        : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    return this.prisma.walletAddress.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: WALLET_INCLUDE,
    });
  }

  async findById(id: string) {
    const wallet = await this.prisma.walletAddress.findUnique({
      where: { id },
      include: WALLET_INCLUDE,
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async update(id: string, dto: UpdateWalletDto) {
    await this.findById(id);
    return this.prisma.walletAddress.update({
      where: { id },
      data: {
        label: dto.label,
        isActive: dto.isActive,
      },
      include: WALLET_INCLUDE,
    });
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.walletAddress.update({
      where: { id },
      data: { isActive: false },
      include: WALLET_INCLUDE,
    });
  }

  /**
   * Internal API for TransactionsModule.
   * Returns one active wallet for the asset-network pair. Throws 400 if none.
   *
   * Strategy: deterministic (oldest active first). For load balancing across
   * many addresses you'd randomize or round-robin; we don't need that yet.
   */
  async pickActiveWallet(assetNetworkId: string) {
    const wallet = await this.prisma.walletAddress.findFirst({
      where: { assetNetworkId, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: WALLET_INCLUDE,
    });
    if (!wallet) {
      throw new BadRequestException(
        'No active wallet for this asset/network combination. Contact support.',
      );
    }
    return wallet;
  }

  private async assertPairExistsAndEnabled(assetNetworkId: string): Promise<void> {
    const pair = await this.prisma.assetNetwork.findUnique({
      where: { id: assetNetworkId },
      select: { id: true, isEnabled: true },
    });
    if (!pair) {
      throw new BadRequestException(`assetNetworkId "${assetNetworkId}" does not exist`);
    }
    if (!pair.isEnabled) {
      throw new BadRequestException(
        'This asset-network pair is disabled. Enable it via /admin/asset-networks first.',
      );
    }
  }
}
