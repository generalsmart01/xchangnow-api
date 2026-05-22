import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';
import { PayoutsService } from './payouts.service';

@Controller('payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // ------------------------- user-facing -------------------------

  @Get('me')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPayoutsQueryDto,
  ) {
    return this.payouts.listMine(user.id, query);
  }

  @Get('me/:id')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.payouts.findMine(user.id, id);
  }

  // ---------------------------- admin ----------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listAll(@Query() query: ListPayoutsQueryDto) {
    return this.payouts.listAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  findById(@Param('id') id: string) {
    return this.payouts.findByIdAsAdmin(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayoutStatusDto,
  ) {
    return this.payouts.updateStatus(admin.id, id, dto);
  }
}
