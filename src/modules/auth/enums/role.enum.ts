// src/modules/auth/enums/role.enum.ts

/**
 * Single source of truth for application roles.
 *
 * Re-exports `UserRole` from the Prisma client under the alias `Role` so
 * that role definitions live in ONE place — the Prisma schema. Adding a new
 * role means editing schema.prisma + running `prisma generate`; never
 * touch this file.
 *
 * Current roles: USER | ADMIN | SUPER_ADMIN | OPS | CUSTOMER_SERVICE
 */

export { UserRole as Role } from '@prisma/client';
