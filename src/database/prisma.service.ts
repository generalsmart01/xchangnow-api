// src/database/prisma.service.ts

/**
 * PrismaService — extends PrismaClient with Nest lifecycle hooks.
 *
 * Why subclass instead of providing a raw PrismaClient instance?
 *   - onModuleInit triggers `$connect()` at boot so the DB connection is
 *     warm before the first request lands. Lazy connection-on-first-query
 *     would add latency to the very first user.
 *   - onModuleDestroy triggers `$disconnect()` on SIGTERM (Nest enables
 *     this via app.enableShutdownHooks() in main.ts) so we close cleanly
 *     instead of leaving zombie connections on the DB side after deploys.
 *   - DI-friendly. Every module just `constructor(private prisma:
 *     PrismaService)` and gets the same shared client.
 *
 * All Prisma client methods (prisma.user.findUnique, $transaction, etc.)
 * are available directly on the service instance via inheritance.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
