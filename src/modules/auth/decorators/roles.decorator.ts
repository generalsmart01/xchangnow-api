import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Attach allowed roles to a route or controller.
 *   @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 * Pair with RolesGuard via @UseGuards(JwtAuthGuard, RolesGuard).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
