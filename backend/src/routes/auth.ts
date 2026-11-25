import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { audit, AuditAction } from '../utils/audit';
import { asyncHandler, HttpError } from '../utils/http';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Compared against when there is no usable account, so "no such user" costs a bcrypt compare like a wrong password does
// (otherwise response time reveals which emails exist). Same cost factor (10) as the seeded passwords.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

type FailReason = 'unknown_email' | 'inactive_account' | 'wrong_password' | 'locked';

authRouter.post('/login', limiter, asyncHandler(async (req, res) => {
  const { email, password } = z.object({ email: z.string().max(254).email(), password: z.string().min(1) }).parse(req.body);
  const bad = new HttpError(401, 'Invalid email or password. Please try again.');
  // What is logged (NFR-12): the attempted email and WHY it failed, never the password. The caller only ever sees a
  // generic message. IP addresses are deliberately not stored: behind a proxy they are the proxy's, and they are personal data.
  const attempted = email.toLowerCase();
  const logFailure = (reason: FailReason, userId?: number) =>
    audit(prisma, { action: AuditAction.LOGIN_FAILED, newValue: { email: attempted, reason, ...(userId ? { userId } : {}) } });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logFailure(user ? 'inactive_account' : 'unknown_email', user?.id);
    throw bad;
  }
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await logFailure('locked', user.id);
    throw new HttpError(429, 'Too many failed attempts. Try again later.');
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    // a lock that has already expired starts a fresh count: one wrong guess must not re-lock the account at once
    const fails = (user.lockedUntil ? 0 : user.failedLoginCount) + 1;
    const lockedUntil = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS) : null;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: fails, lockedUntil } });
      await logFailure('wrong_password', user.id);
      if (lockedUntil)
        await audit(tx, {
          action: AuditAction.ACCOUNT_LOCKED, actorType: 'SYSTEM',
          newValue: { userId: user.id, email: attempted, failedAttempts: fails, lockedUntil: lockedUntil.toISOString() },
        });
    });
    throw bad;
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await audit(tx, { action: AuditAction.LOGIN_SUCCEEDED, actorId: user.id, newValue: { email: attempted } });
  });
  const accessToken = jwt.sign({ role: user.role }, config.jwtSecret, { subject: String(user.id), expiresIn: config.jwtExpiresInSeconds });
  res.json({ accessToken, role: user.role });
}));

// Current user profile (the frontend uses it to build role-based navigation)
authRouter.get('/me', authenticate, asyncHandler(async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!u || !u.isActive) throw new HttpError(401, 'Invalid or expired token');
  res.json(u);
}));
