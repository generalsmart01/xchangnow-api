// src/modules/auth/decorators/roles.decorator.ts

/**
 * @Roles(...) — declares which roles may access a route or controller.
 * Read by RolesGuard via Reflector.
 *
 * Apply at either level:
 *   - On the controller (every route inherits the requirement)
 *   - On a single handler (overrides the controller-level if both set)
 *
 * Always pair with `@UseGuards(JwtAuthGuard, RolesGuard)` — RolesGuard
 * needs `request.user` populated by JwtAuthGuard first.
 *
 * @example
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 *   @Get()
 *   listAll() { ... }
 */

import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
