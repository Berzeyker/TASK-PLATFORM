import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { asyncHandler, HttpError } from '../utils/http';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
const MAX_FAILS = 5;

authRouter.post('/login', limiter, asyncHandler(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const bad = new HttpError(401, 'Invalid email or password. Please try again.');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) throw bad;
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpError(429, 'Too many failed attempts. Try again later.');
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const fails = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + 15 * 60 * 1000) : null },
    });
    throw bad;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const accessToken = jwt.sign({ role: user.role }, config.jwtSecret, { subject: String(user.id), expiresIn: config.jwtExpiresInSeconds });
  res.json({ accessToken, role: user.role });
}));
