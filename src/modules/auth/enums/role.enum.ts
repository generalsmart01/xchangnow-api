// Single source of truth for roles — re-exports the Prisma-generated enum
// so we never duplicate role definitions between DB and code.
export { UserRole as Role } from '@prisma/client';
