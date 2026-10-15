import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { config } from '../config';
import { HttpError } from '../utils/http';

declare global {
  namespace Express { interface Request { user?: { id: number; role: Role } } }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing token');
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload; }
  catch { throw new HttpError(401, 'Invalid or expired token'); }
  req.user = { id: Number(payload.sub), role: payload.role as Role };
  next();
}

// RBAC (FR-16, NFR-02): 403 for any out-of-role action
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role))
    throw new HttpError(403, 'Access denied. You do not have permissions for this action.');
  next();
};
