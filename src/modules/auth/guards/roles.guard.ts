// src/modules/auth/guards/roles.guard.ts

/**
 * RolesGuard — enforces role-based access control. Reads @Roles(...) metadata
 * set by the decorator and rejects requests whose authenticated user isn't
 * in the allowed list.
 *
 * Always chain AFTER JwtAuthGuard so `request.user` is populated:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 *
 * No @Roles() = no requirement (pass-through). This is what lets us declare
 * the guard once at the controller level and only enforce on specific routes.
 *
 * Method-level metadata overrides class-level (Nest's standard reflector
 * behavior via getAllAndOverride). Useful when a controller is mostly admin
 * but has one public route.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() declared → no role requirement, pass through.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('No authenticated user');

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
