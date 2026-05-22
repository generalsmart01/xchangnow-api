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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ApproveTransactionDto } from './dto/approve-transaction.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { CreateSellDto } from './dto/create-sell.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { UploadProofDto } from './dto/upload-proof.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard) // every route requires JWT; @Roles enforced only where set
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  // -------------------------- user-facing --------------------------

  @Post('sell')
  createSell(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSellDto,
  ) {
    return this.transactions.createSell(user.id, dto);
  }

  @Post('buy')
  createBuy(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBuyDto,
  ) {
    return this.transactions.createBuy(user.id, dto);
  }

  @Get('me')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactions.listMine(user.id, query);
  }

  @Get('me/:id')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.transactions.findMine(user.id, id);
  }

  @Post('me/:id/proof')
  @HttpCode(HttpStatus.CREATED)
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
  listAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactions.listAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  findById(@Param('id') id: string) {
    return this.transactions.findByIdAsAdmin(id);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
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
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectTransactionDto,
  ) {
    return this.transactions.reject(admin.id, id, dto);
  }
}
