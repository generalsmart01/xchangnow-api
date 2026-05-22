import { Controller, Get, UseGuards } from '@nestjs/common';
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

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard) // controller-wide: must be logged in + role-checked
export class AdminController {
  @Get('ping')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) Sanity check the JWT + Roles guard chain',
    description:
      'Lightweight endpoint used to confirm the auth chain. Returns the ' +
      'authenticated admin\'s identity. Not part of any real workflow — ' +
      'just useful for end-to-end smoke tests and confirming a deploy works.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pong.',
    schema: {
      example: {
        ok: true,
        message: 'Admin pong',
        adminId: 'cmpgx5qjh0000o85kzmyj8zpy',
        adminEmail: 'admin@xchangenow.com',
        adminRole: 'ADMIN',
        checkedAt: '2026-05-22T14:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  ping(@CurrentUser() admin: AuthenticatedUser) {
    return {
      ok: true,
      message: 'Admin pong',
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      checkedAt: new Date().toISOString(),
    };
  }
}
