import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN) // controller-level → applies to every route
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  create(@Body() dto: CreateWalletDto) {
    return this.wallets.create(dto);
  }

  @Get()
  list(@Query() query: ListWalletsQueryDto) {
    return this.wallets.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.wallets.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWalletDto) {
    return this.wallets.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.wallets.deactivate(id);
  }
}
