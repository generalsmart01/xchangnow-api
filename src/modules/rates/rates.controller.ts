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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

const RATE_EXAMPLE = {
  id: 'cmph19915000ho850d27tijhm',
  asset: 'BTC',
  fiatCurrency: 'NGN',
  buyRate: '70000000.00',
  sellRate: '68000000.00',
  source: 'manual',
  isManualOverride: true,
  updatedById: 'cmpgx5qjh0000o85kzmyj8zpy',
  fetchedAt: '2026-05-22T14:30:00.000Z',
};

const CURRENT_EXAMPLE = {
  fiatCurrency: 'NGN',
  rates: [
    {
      asset: 'BTC',
      buyRate: '70000000.00',
      sellRate: '68000000.00',
      source: 'manual',
      fetchedAt: '2026-05-22T14:30:00.000Z',
    },
    {
      asset: 'USDT',
      buyRate: '1600.00',
      sellRate: '1550.00',
      source: 'manual',
      fetchedAt: '2026-05-22T14:30:00.000Z',
    },
  ],
};

@ApiTags('Rates')
@ApiBearerAuth('JWT-auth')
@Controller('rates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Get the latest rate per asset',
    description:
      'Returns the most recent rate snapshot per supported asset (BTC/ETH/USDT/USDC) ' +
      'for the given fiat (defaults to NGN). Missing assets — those with no row ever ' +
      'recorded — are simply omitted from the result. ' +
      'Available to any authenticated user (they need to see prices before transacting).',
  })
  @ApiResponse({
    status: 200,
    description: 'Latest rate snapshot per asset.',
    schema: { example: CURRENT_EXAMPLE },
  })
  current() {
    return this.rates.current();
  }

  // -------------------------- admin --------------------------

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) Record a new rate snapshot',
    description:
      'Rates are time-series — each POST creates a NEW row, never updates ' +
      'an existing one. /current then picks the latest. ' +
      'Used by TransactionsService.currentRate() (within the last hour) ' +
      'before falling back to hardcoded constants.',
  })
  @ApiResponse({
    status: 201,
    description: 'Rate snapshot created.',
    schema: { example: RATE_EXAMPLE },
  })
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateRateDto,
  ) {
    return this.rates.create(admin.id, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) List rate history',
    description:
      'Paginated list of all rate snapshots, newest first. Use filters to ' +
      'narrow by asset / fiat — useful for tracking rate changes over time.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        rates: [RATE_EXAMPLE],
        total: 24,
        page: 1,
        pageSize: 20,
      },
    },
  })
  list(@Query() query: ListRatesQueryDto) {
    return this.rates.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: '(Admin) Get a rate snapshot by id' })
  @ApiResponse({ status: 200, schema: { example: RATE_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Rate not found.' })
  findById(@Param('id') id: string) {
    return this.rates.findById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) Edit an existing rate row',
    description:
      'Use sparingly — typically you POST a new snapshot instead. This is for ' +
      'fixing typos on a recent row. Asset / fiatCurrency are immutable; if ' +
      'those are wrong, DELETE and POST a new one.',
  })
  @ApiResponse({ status: 200, schema: { example: RATE_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Rate not found.' })
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
  @ApiOperation({
    summary: '(Admin) Delete a rate row',
    description:
      'Hard delete. The /current lookup will fall through to the next-most-recent ' +
      'row for the same asset/fiat (or to the hardcoded fallback if none).',
  })
  @ApiResponse({ status: 204, description: 'Rate deleted.' })
  @ApiResponse({ status: 404, description: 'Rate not found.' })
  delete(@Param('id') id: string) {
    return this.rates.delete(id);
  }
}
