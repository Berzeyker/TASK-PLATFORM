import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);
categoriesRouter.get('/', asyncHandler(async (_req, res) => {
  res.json(await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
}));
categoriesRouter.post('/', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2) }).parse(req.body);
  res.status(201).json(await prisma.category.create({ data: { name } }));
}));

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN'));
adminRouter.get('/users', asyncHandler(async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, email: true, fullName: true, role: true, isActive: true } }));
}));
adminRouter.post('/users', asyncHandler(async (req, res) => {
  const b = z.object({
    email: z.string().email(), fullName: z.string().min(2), role: z.nativeEnum(Role), password: z.string().min(10),
  }).parse(req.body);
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, 'Email already registered');
  const u = await prisma.user.create({ data: { email: b.email, fullName: b.fullName, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) } });
  res.status(201).json({ id: u.id, email: u.email, fullName: u.fullName, role: u.role });
}));
