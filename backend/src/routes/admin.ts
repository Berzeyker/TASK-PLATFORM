import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { audit, AuditAction } from '../utils/audit';

const idParam = (value: string) => z.coerce.number().int().positive().parse(value);
const atLeastOne = (o: object) => Object.keys(o).length > 0;

// ---------- categories ----------
export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

// Everyone sees active categories; an admin can ask for inactive ones too (to reactivate them).
categoriesRouter.get('/', asyncHandler(async (req, res) => {
  const { includeInactive } = z.object({ includeInactive: z.enum(['true', 'false']).optional() }).parse(req.query);
  const all = includeInactive === 'true';
  if (all && req.user!.role !== 'ADMIN') throw new HttpError(403, 'Access denied.');
  res.json(await prisma.category.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: 'asc' } }));
}));

categoriesRouter.post('/', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2) }).parse(req.body);
  const created = await prisma.$transaction(async (tx) => {
    if (await tx.category.findUnique({ where: { name } })) throw new HttpError(409, 'A category with that name already exists.');
    const c = await tx.category.create({ data: { name } });
    await audit(tx, { actorId: req.user!.id, action: AuditAction.CATEGORY_CREATED, newValue: { categoryId: c.id, name: c.name } });
    return c;
  });
  res.status(201).json(created);
}));

// B-05: rename or (de)activate. Categories are never deleted: tickets and articles keep pointing at them.
// A deactivated category disappears from pickers (ticket creation already requires an active one).
categoriesRouter.put('/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = z.object({ name: z.string().trim().min(2).optional(), isActive: z.boolean().optional() })
    .strict().refine(atLeastOne, { message: 'Nothing to update' }).parse(req.body);

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.category.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Category not found');
    if (b.name && b.name !== before.name && (await tx.category.findUnique({ where: { name: b.name } })))
      throw new HttpError(409, 'A category with that name already exists.');
    const c = await tx.category.update({ where: { id }, data: b });
    await audit(tx, {
      actorId: req.user!.id, action: AuditAction.CATEGORY_UPDATED,
      oldValue: { categoryId: id, name: before.name, isActive: before.isActive },
      newValue: { categoryId: id, name: c.name, isActive: c.isActive },
    });
    return c;
  });
  res.json(updated);
}));

// ---------- users ----------
export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN'));

const publicUser = { id: true, email: true, fullName: true, role: true, isActive: true } as const;

adminRouter.get('/users', asyncHandler(async (_req, res) => {
  res.json(await prisma.user.findMany({ select: publicUser, orderBy: { id: 'asc' } }));
}));

adminRouter.post('/users', asyncHandler(async (req, res) => {
  const b = z.object({
    email: z.string().email(), fullName: z.string().min(2), role: z.nativeEnum(Role), password: z.string().min(10),
  }).parse(req.body);
  const passwordHash = await bcrypt.hash(b.password, 10);
  const u = await prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, 'Email already registered');
    const created = await tx.user.create({ data: { email: b.email, fullName: b.fullName, role: b.role, passwordHash } });
    await audit(tx, { actorId: req.user!.id, action: AuditAction.USER_CREATED, newValue: { userId: created.id, email: created.email, role: created.role } });
    return created;
  });
  res.status(201).json({ id: u.id, email: u.email, fullName: u.fullName, role: u.role });
}));

// B-05: edit name/role, activate/deactivate, optional password reset (which also clears a login lockout).
adminRouter.put('/users/:id', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = z.object({
    fullName: z.string().trim().min(2).optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(10).optional(),
  }).strict().refine(atLeastOne, { message: 'Nothing to update' }).parse(req.body);

  const actorId = req.user!.id;
  if (id === actorId && b.isActive === false) throw new HttpError(409, 'You cannot deactivate your own account.');
  const passwordHash = b.password ? await bcrypt.hash(b.password, 10) : undefined; // hash outside the transaction

  // Serializable so two admins cannot each remove "the other" admin at the same time.
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: publicUser });
    if (!before) throw new HttpError(404, 'User not found');
    if (id === actorId && b.role && b.role !== before.role) throw new HttpError(409, 'You cannot change your own role.');

    const losesAdmin = before.role === 'ADMIN' && before.isActive && ((b.role && b.role !== 'ADMIN') || b.isActive === false);
    if (losesAdmin && (await tx.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: id } } })) === 0)
      throw new HttpError(409, 'At least one active administrator is required.');

    const data: Prisma.UserUpdateInput = { fullName: b.fullName, role: b.role, isActive: b.isActive };
    if (passwordHash) Object.assign(data, { passwordHash, failedLoginCount: 0, lockedUntil: null });
    const u = await tx.user.update({ where: { id }, data, select: publicUser });
    await audit(tx, {
      actorId, action: AuditAction.USER_UPDATED,
      oldValue: { userId: id, fullName: before.fullName, role: before.role, isActive: before.isActive },
      newValue: { userId: id, fullName: u.fullName, role: u.role, isActive: u.isActive, ...(passwordHash ? { passwordReset: true } : {}) },
    });
    return u;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(updated);
}));

// B-03: read the audit trail (NFR-12). Admin only: rows hold emails of failed login attempts and who changed what.
adminRouter.get('/audit', asyncHandler(async (req, res) => {
  const actions = Object.values(AuditAction) as [string, ...string[]];
  const q = z.object({
    action: z.enum(actions).optional(),
    actorId: z.coerce.number().int().positive().optional(),
    ticketId: z.string().max(40).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);
  if (q.from && q.to && q.from > q.to) throw new HttpError(400, 'Invalid date range');

  const where: Prisma.AuditLogWhereInput = {
    action: q.action, actorId: q.actorId, ticketId: q.ticketId,
    ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is number => id !== null))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, role: true } }) : [];
  res.json({ items: rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actorId) ?? null })), total, page: q.page, pageSize: q.pageSize });
}));
