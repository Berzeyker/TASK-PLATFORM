import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';

export const metricsRouter = Router();
metricsRouter.use(authenticate, requireRole('MANAGER', 'ADMIN'));

// FR-15 / UC-04: ticket volume, MTTR, AI deflection rate for a date range
metricsRouter.get('/', asyncHandler(async (req, res) => {
  const q = z.object({
    from: z.coerce.date().optional(), to: z.coerce.date().optional(),
    categoryId: z.coerce.number().int().optional(),
  }).parse(req.query);
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  if (from > to) throw new HttpError(400, 'Invalid date range');

  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: from, lte: to }, ...(q.categoryId ? { categoryId: q.categoryId } : {}) },
    select: { createdAt: true, resolvedAt: true, status: true, priority: true },
  });

  const count = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const byStatus = count(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED']);
  const byPriority = count(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  const perDay: Record<string, number> = {};
  let resolvedMs = 0, resolvedCount = 0;
  for (const t of tickets) {
    byStatus[t.status]++; byPriority[t.priority]++;
    const day = t.createdAt.toISOString().slice(0, 10);
    perDay[day] = (perDay[day] ?? 0) + 1;
    if (t.resolvedAt) { resolvedMs += t.resolvedAt.getTime() - t.createdAt.getTime(); resolvedCount++; }
  }

  // Deflection rate = deflected AI sessions / (deflected sessions + tickets created). Null until there is data.
  const deflectedCount = await prisma.aiInteraction.count({
    where: { outcome: 'DEFLECTED', createdAt: { gte: from, lte: to } },
  });
  const denominator = deflectedCount + tickets.length;

  res.json({
    range: { from, to },
    totalTickets: tickets.length,
    byStatus, byPriority,
    ticketsPerDay: Object.entries(perDay).sort().map(([date, n]) => ({ date, count: n })),
    resolvedCount,
    mttrHours: resolvedCount ? Math.round((resolvedMs / resolvedCount / 3600000) * 100) / 100 : null, // tickets created in range that were resolved
    deflectedCount,
    deflectionRate: denominator ? Math.round((deflectedCount / denominator) * 10000) / 10000 : null,
  });
}));
