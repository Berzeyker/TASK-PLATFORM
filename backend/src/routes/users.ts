import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';

export const usersRouter = Router();
usersRouter.use(authenticate);

// Active staff list for assignment dropdowns. Non-admins can only list agents.
usersRouter.get('/', requireRole('AGENT', 'MANAGER', 'ADMIN'), asyncHandler(async (req, res) => {
  const { role } = z.object({ role: z.nativeEnum(Role).default('AGENT') }).parse(req.query);
  if (role !== 'AGENT' && req.user!.role !== 'ADMIN') throw new HttpError(403, 'Access denied.');
  res.json(await prisma.user.findMany({
    where: { role, isActive: true },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: { fullName: 'asc' },
  }));
}));
