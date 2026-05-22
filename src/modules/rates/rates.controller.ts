import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { CreateRateDto } from './dto/create-rate.dto';
import { ListRatesQueryDto } from './dto/list-rates-query.dto';
import { UpdateRateDto } from './dto/update-rate.dto';
import { RatesService } from './rates.service';

@Controller('rates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  // Any authenticated user — must see prices to decide on a transaction.
  @Get('current')
  current() {
    return this.rates.current();
  }

  // -------------------------- admin --------------------------

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateRateDto,
  ) {
    return this.rates.create(admin.id, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  list(@Query() query: ListRatesQueryDto) {
    return this.rates.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  findById(@Param('id') id: string) {
    return this.rates.findById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRateDto,
  ) {
    return this.rates.update(admin.id, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string) {
    return this.rates.delete(id);
  }
}
