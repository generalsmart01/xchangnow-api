// src/database/prisma.module.ts

/**
 * PrismaModule — @Global so PrismaService is injectable everywhere without
 * per-module imports. Every other module that needs DB access just imports
 * `PrismaService` and Nest's DI handles the rest.
 *
 * Mirrors the pattern PiiModule uses. Reserved for cross-cutting services
 * that genuinely belong in every module's DI graph.
 */

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
