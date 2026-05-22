import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CryptoAsset,
  CryptoNetwork,
  Prisma,
  WalletAddress,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWalletDto): Promise<WalletAddress> {
    try {
      return await this.prisma.walletAddress.create({
        data: {
          cryptoAsset: dto.cryptoAsset,
          network: dto.network,
          address: dto.address,
          label: dto.label,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Wallet address already exists for this asset/network',
        );
      }
      throw err;
    }
  }

  list(query: ListWalletsQueryDto): Promise<WalletAddress[]> {
    return this.prisma.walletAddress.findMany({
      where: {
        ...(query.asset ? { cryptoAsset: query.asset } : {}),
        ...(query.network ? { network: query.network } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string): Promise<WalletAddress> {
    const wallet = await this.prisma.walletAddress.findUnique({
      where: { id },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async update(id: string, dto: UpdateWalletDto): Promise<WalletAddress> {
    await this.findById(id); // 404 check
    return this.prisma.walletAddress.update({
      where: { id },
      data: {
        label: dto.label,
        isActive: dto.isActive,
      },
    });
  }

  async deactivate(id: string): Promise<WalletAddress> {
    await this.findById(id);
    return this.prisma.walletAddress.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Internal API for TransactionsModule.
   * Returns one active wallet for the asset/network. Throws if none available.
   *
   * Strategy: deterministic (oldest active first). For load balancing across
   * many addresses you'd randomize or round-robin; we don't need that yet.
   */
  async pickActiveWallet(
    asset: CryptoAsset,
    network: CryptoNetwork,
  ): Promise<WalletAddress> {
    const wallet = await this.prisma.walletAddress.findFirst({
      where: { cryptoAsset: asset, network, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) {
      throw new BadRequestException(
        `No active ${asset} wallet on ${network}. Contact support.`,
      );
    }
    return wallet;
  }
}
