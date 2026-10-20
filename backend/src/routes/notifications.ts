import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

// FR-17: in-app notifications for the current user
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const { unread } = z.object({ unread: z.enum(['true', 'false']).optional() }).parse(req.query);
  const userId = req.user!.id;
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(unread === 'true' ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' }, take: 50,
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  res.json({ items, unreadCount });
}));

notificationsRouter.put('/read-all', asyncHandler(async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  res.json({ updated: r.count });
}));

notificationsRouter.put('/:id/read', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const n = await prisma.notification.findFirst({ where: { id, userId: req.user!.id } });
  if (!n) throw new HttpError(404, 'Notification not found');
  res.json(await prisma.notification.update({ where: { id }, data: { isRead: true } }));
}));
