// src/common/utils/flatten-user.ts

/**
 * User and Profile live in separate tables (PII isolation, see
 * schema.prisma). For a clean FE API, we present them as ONE flat object
 * on the wire: { id, email, firstName, lastName, phoneNumber, role, ... }.
 *
 * This helper does the flattening + strips `passwordHash`, so services
 * don't repeat the same merge logic at every endpoint. The
 * `phoneNumberNormalized` field is also intentionally NOT exposed — that
 * column is for backend uniqueness lookups only; the FE sees `phoneNumber`
 * (the raw input the user typed).
 */

import { Profile, User } from '@prisma/client';

export type SafeUser = Omit<User, 'passwordHash'> & {
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
};

/**
 * Flatten a User row with its Profile relation into the wire shape we return
 * to clients. The `profile` field is omitted; its fields are hoisted to the
 * top level. `passwordHash` is stripped.
 *
 * Profile is optional in the type to be defensive — every register flow
 * creates one, so in practice this should never be null. If it is, we fall
 * back to empty strings so the JSON shape stays stable.
 */
export function flattenUser(
  user: User & { profile?: Profile | null },
): SafeUser {
  const { passwordHash: _omit, profile, ...rest } = user;
  return {
    ...rest,
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    phoneNumber: profile?.phoneNumber ?? null,
  };
}
