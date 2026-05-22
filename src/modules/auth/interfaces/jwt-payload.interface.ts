import { Role } from '../enums/role.enum';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: Role;
  sessionId: string; // links the JWT to a server-side session row (revocable)
}

// What we attach to req.user after a successful JwtStrategy.validate()
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}
