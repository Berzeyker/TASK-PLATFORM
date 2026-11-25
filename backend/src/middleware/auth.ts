import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { asyncGuard, HttpError } from '../utils/http';

declare global {
  namespace Express { interface Request { user?: { id: number; role: Role } } }
}

// Decision (B-02): check the user in the database on every request.
// A signed token only proves who the caller was when it was issued. Admins can now deactivate accounts and change
// roles (B-05), and that must apply immediately, not after the 15-minute token expires. The cost is one primary-key
// lookup per request. The role is therefore read from the database; the role claim inside the token is ignored.
export const authenticate = asyncGuard(async (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing token');
  let payload: jwt.JwtPayload;
  try {
    // pin the algorithm: a token signed with another one is rejected even if the secret matches
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(401, 'Invalid or expired token');

  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (!user || !user.isActive) throw new HttpError(401, 'Invalid or expired token');
  req.user = { id, role: user.role };
});

// RBAC (FR-16, NFR-02): 403 for any out-of-role action
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role))
    throw new HttpError(403, 'Access denied. You do not have permissions for this action.');
  next();
};
