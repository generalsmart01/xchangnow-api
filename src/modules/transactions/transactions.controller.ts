import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireVerified } from '../auth/decorators/require-verified.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedGuard } from '../auth/guards/verified.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ApproveTransactionDto } from './dto/approve-transaction.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { CreateSellDto } from './dto/create-sell.dto';
import { CreateSwapDto } from './dto/create-swap.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { MarkCompletedDto } from './dto/mark-completed.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { UploadProofDto } from './dto/upload-proof.dto';
import { TransactionsService } from './transactions.service';

const SELL_EXAMPLE = {
  id: 'cmpgzemmo0009o8nkp8cc9pk7',
  referenceCode: 'XCN-A55A2689',
  userId: 'cmpgx5qjh0000o85kzmyj8zpy',
  type: 'SELL',
  status: 'PENDING',
  cryptoAsset: 'BTC',
  network: 'BITCOIN',
  cryptoAmount: '0.005',
  fiatAmount: '290000.00',
  fiatCurrency: 'NGN',
  rate: '58000000.00',
  walletAddressId: 'cmpgx5rxg000eo85k60xgd3fr',
  txHash: null,
  riskScore: 0,
  approvedById: null,
  approvedAt: null,
  rejectedReason: null,
  expiresAt: '2026-05-22T15:00:00.000Z',
  completedAt: null,
  createdAt: '2026-05-22T14:30:00.000Z',
  updatedAt: '2026-05-22T14:30:00.000Z',
  walletAddress: {
    id: 'cmpgx5rxg000eo85k60xgd3fr',
    cryptoAsset: 'BTC',
    network: 'BITCOIN',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    label: 'Primary BTC',
    isActive: true,
  },
};

const BUY_EXAMPLE = {
  id: 'cmpg8k53f000bo84wu80ay5lo',
  referenceCode: 'XCN-7503C7E4',
  userId: 'cmpgx5qjh0000o85kzmyj8zpy',
  type: 'BUY',
  status: 'AWAITING_PAYMENT',
  cryptoAsset: 'USDT',
  network: 'TRON',
  cryptoAmount: '20.000000000000000000',
  fiatAmount: '30000.00',
  fiatCurrency: 'NGN',
  rate: '1500.00',
  walletAddressId: null,
  paymentInstructions: {
    bankName: 'Wema Bank',
    accountNumber: '0123456789',
    accountName: 'XchangeNow Ltd',
    reference: 'XCN-7503C7E4',
  },
  createdAt: '2026-05-22T14:30:00.000Z',
};

const SWAP_EXAMPLE = {
  id: 'cmpgzemmo0009o8nkp8cc9pk7',
  referenceCode: 'XCN-A55A2689',
  type: 'SWAP',
  status: 'PENDING',
  cryptoAsset: 'BTC',
  network: 'BITCOIN',
  cryptoAmount: '0.005',
  toAsset: 'USDT',
  toNetwork: 'TRON',
  toAmount: '193.333333333333333334',
  toAddress: 'TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt',
  rate: '38666.666666666666667',
  fiatAmount: null,
  fiatCurrency: null,
  walletAddress: {
    cryptoAsset: 'BTC',
    network: 'BITCOIN',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  },
};

const PROOF_EXAMPLE = {
  id: 'cmpgzemqx000bo8nkghlr93p3',
  transactionId: 'cmpgzemmo0009o8nkp8cc9pk7',
  type: 'CRYPTO_TX_HASH',
  url: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
  notes: null,
  uploadedAt: '2026-05-22T14:35:00.000Z',
};

@ApiTags('Transactions')
@ApiBearerAuth('JWT-auth')
@Controller('transactions')
// JWT required everywhere; @Roles enforced where set; @RequireVerified enforced where set.
@UseGuards(JwtAuthGuard, RolesGuard, VerifiedGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  // -------------------------- user-facing --------------------------

  @Post('sell')
  @RequireVerified()
  @ApiOperation({
    summary: 'Create a SELL transaction',
    description:
      'User sells crypto to us, receives fiat (NGN) via bank payout. ' +
      'Requires a default bank account (400 otherwise — set one via ' +
      'POST /users/me/bank-accounts first). Requires email verification. ' +
      'Returns the transaction record including a company `walletAddress` ' +
      'the user must send the crypto to. After sending, the user calls ' +
      '/transactions/me/:id/proof with the on-chain tx hash.',
  })
  @ApiResponse({
    status: 201,
    description: 'Transaction created with status=PENDING.',
    schema: { example: SELL_EXAMPLE },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error, no default bank account set, or no active wallet ' +
      'available for the chosen asset/network.',
  })
  @ApiResponse({ status: 403, description: 'Email not verified.' })
  createSell(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSellDto,
  ) {
    return this.transactions.createSell(user.id, dto);
  }

  @Post('buy')
  @RequireVerified()
  @ApiOperation({
    summary: 'Create a BUY transaction',
    description:
      'User buys crypto from us, paying with NGN bank transfer. ' +
      'Returns the transaction + `paymentInstructions` (our bank details + ' +
      'a `reference` string the user must include in the transfer narration). ' +
      'Status starts at AWAITING_PAYMENT. After paying, the user uploads the ' +
      'bank receipt via /transactions/me/:id/proof.',
  })
  @ApiResponse({
    status: 201,
    description: 'Transaction created with paymentInstructions.',
    schema: { example: BUY_EXAMPLE },
  })
  @ApiResponse({ status: 403, description: 'Email not verified.' })
  createBuy(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBuyDto,
  ) {
    return this.transactions.createBuy(user.id, dto);
  }

  @Post('swap')
  @RequireVerified()
  @ApiOperation({
    summary: 'Create a SWAP transaction',
    description:
      'Crypto-to-crypto exchange. User sends FROM-asset to our company wallet, ' +
      'we send TO-asset to their `toAddress` after admin approval. ' +
      'Rate is derived from existing NGN-pegged rates: ' +
      '`pairRate = fromSellRate / toBuyRate`. The buy-sell spread is our fee. ' +
      '`fromAsset` must differ from `toAsset` (400 if equal). ' +
      'No fiat side — `fiatAmount`/`fiatCurrency` are null.',
  })
  @ApiResponse({
    status: 201,
    description: 'Swap created.',
    schema: { example: SWAP_EXAMPLE },
  })
  @ApiResponse({
    status: 400,
    description:
      'Same asset on both sides, no active wallet for FROM asset/network, ' +
      'or validation error.',
  })
  @ApiResponse({ status: 403, description: 'Email not verified.' })
  createSwap(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSwapDto,
  ) {
    return this.transactions.createSwap(user.id, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'List MY transactions',
    description:
      'Paginated, optionally filtered by status / type / asset. Returns the ' +
      'caller\'s transactions only (userId scope enforced server-side).',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list.',
    schema: {
      example: {
        transactions: [SELL_EXAMPLE],
        total: 5,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactions.listMine(user.id, query);
  }

  @Get('me/:id')
  @ApiOperation({
    summary: 'Get one of MY transactions',
    description:
      'Returns the full transaction record with proofs[] and walletAddress. ' +
      '404 if the id does not exist OR belongs to another user (same response ' +
      'to avoid leaking existence).',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction with proofs and walletAddress.',
    schema: {
      example: { ...SELL_EXAMPLE, proofs: [PROOF_EXAMPLE] },
    },
  })
  @ApiResponse({ status: 404, description: 'Not found / not yours.' })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.transactions.findMine(user.id, id);
  }

  @Post('me/:id/proof')
  @RequireVerified()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload payment proof for my transaction',
    description:
      'Records the proof (tx hash for SELL/SWAP, receipt URL for BUY) and ' +
      'atomically advances the status to UNDER_REVIEW. ' +
      'Proof type must match the transaction type: ' +
      'SELL/SWAP → CRYPTO_TX_HASH; BUY → BANK_TRANSFER_RECEIPT. ' +
      'For SELL/SWAP the value is also mirrored onto transaction.txHash ' +
      '(@unique system-wide — duplicate hash returns 409).',
  })
  @ApiResponse({
    status: 201,
    description: 'Proof recorded and transaction advanced to UNDER_REVIEW.',
    schema: { example: PROOF_EXAMPLE },
  })
  @ApiResponse({
    status: 400,
    description:
      'Wrong proof type for this transaction type, or transaction is not in ' +
      'PENDING / AWAITING_PAYMENT (state-machine guard).',
  })
  @ApiResponse({ status: 403, description: 'Email not verified.' })
  @ApiResponse({ status: 404, description: 'Transaction not found / not yours.' })
  @ApiResponse({
    status: 409,
    description:
      'Duplicate tx hash — this hash has already been used by another ' +
      'transaction in the system (anti-replay).',
  })
  uploadProof(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadProofDto,
  ) {
    return this.transactions.uploadProof(user.id, id, dto);
  }

  // ---------------------------- admin ----------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) List ALL transactions across users',
    description:
      'System-wide paginated list. Same filters as /me plus `userId`. ' +
      'Use this for ops dashboards / reviewing UNDER_REVIEW queue.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list across all users.',
    schema: {
      example: {
        transactions: [SELL_EXAMPLE],
        total: 137,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactions.listAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) Get any transaction by id',
    description:
      'Includes proofs, walletAddress, and the associated user record. ' +
      'For admin verification screens.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        ...SELL_EXAMPLE,
        proofs: [PROOF_EXAMPLE],
        user: {
          id: 'cmpgx5qjh0000o85kzmyj8zpy',
          email: 'michael@xchangenow.com',
          firstName: 'Michael',
          lastName: 'Adeleke',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Transaction not found.' })
  findById(@Param('id') id: string) {
    return this.transactions.findByIdAsAdmin(id);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '(Admin) Approve a transaction',
    description:
      'State machine: UNDER_REVIEW → APPROVED. ' +
      'For SELL: a Payout row is auto-created (PENDING) pointing at the user\'s ' +
      'current default bank account, with `reference` mirroring the ' +
      'transaction\'s `referenceCode`. ' +
      'For BUY/SWAP: no payout (admin sends crypto manually, then uses ' +
      'POST /:id/mark-completed with the outbound tx hash).',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction approved.',
    schema: {
      example: { ...SELL_EXAMPLE, status: 'APPROVED', approvedById: 'admin-id', approvedAt: '2026-05-22T14:35:00.000Z' },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Cannot approve from current status (must be UNDER_REVIEW), or SELL user ' +
      'no longer has a default bank account.',
  })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveTransactionDto,
  ) {
    return this.transactions.approve(admin.id, id, dto);
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '(Admin) Reject a transaction',
    description:
      'State machine: PENDING / AWAITING_PAYMENT / UNDER_REVIEW → REJECTED. ' +
      'Reason is required and surfaced back to the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction rejected.',
    schema: {
      example: { ...SELL_EXAMPLE, status: 'REJECTED', rejectedReason: 'Receipt unreadable' },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot reject from current status (already APPROVED/COMPLETED/etc).',
  })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectTransactionDto,
  ) {
    return this.transactions.reject(admin.id, id, dto);
  }

  @Post(':id/mark-completed')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '(Admin) Mark a BUY/SWAP transaction COMPLETED',
    description:
      'State machine: APPROVED → COMPLETED. Use this once the admin has ' +
      'manually sent crypto to the user (recording the outbound tx hash). ' +
      'NOT for SELL — SELL completes automatically when its Payout is marked ' +
      'PAID via /payouts/:id/status. ' +
      '`outboundTxHash` is required (400 if missing). Stored as a ' +
      'TransactionProof row with type=OTHER + descriptive notes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction completed.',
    schema: {
      example: { ...SELL_EXAMPLE, status: 'COMPLETED', completedAt: '2026-05-22T14:40:00.000Z' },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Not APPROVED, called on a SELL transaction (use payout PAID instead), ' +
      'or missing outboundTxHash.',
  })
  markCompleted(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkCompletedDto,
  ) {
    return this.transactions.markCompleted(admin.id, id, dto);
  }
}
