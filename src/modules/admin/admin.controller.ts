import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard) // controller-wide: must be logged in + role-checked
export class AdminController {
  // Smoke endpoint to prove the two-guard chain works.
  // JwtAuthGuard authenticates; RolesGuard authorizes against @Roles().
  @Get('ping')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
