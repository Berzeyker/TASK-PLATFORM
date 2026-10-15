import { Router } from 'express';
import { Prisma, Priority, TicketStatus as S } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { newTicketId } from '../utils/ticketId';

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// Allowed transitions. CLOSED is terminal (BR-03).
const NEXT: Record<S, S[]> = {
  OPEN: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS', 'RESOLVED'], IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'], REOPENED: ['ASSIGNED'], CLOSED: [],
};
const isStaff = (role: string) => role === 'AGENT' || role === 'MANAGER' || role === 'ADMIN';
const alnum = (s: string) => (s.match(/[a-z0-9]/gi) ?? []).length;

// FR-01: create ticket
ticketsRouter.post('/', requireRole('EMPLOYEE'), asyncHandler(async (req, res) => {
  const b = z.object({
    title: z.string().trim().min(5).max(150),
    description: z.string().trim().min(10),
    categoryId: z.number().int(),
    affectedDevice: z.string().optional(),
    location: z.string().optional(),
  }).parse(req.body);
  const category = await prisma.category.findFirst({ where: { id: b.categoryId, isActive: true } });
  if (!category) throw new HttpError(400, 'Invalid category');
  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.create({ data: { ...b, id: newTicketId(), requesterId: req.user!.id } });
    await tx.auditLog.create({ data: { ticketId: t.id, actorId: req.user!.id, action: 'TICKET_CREATED', newValue: { status: t.status } } });
    return t;
  });
  res.status(201).json(ticket);
}));

// Queue: employees see only their own tickets (FR-03)
ticketsRouter.get('/', asyncHandler(async (req, res) => {
  const q = z.object({
    status: z.nativeEnum(S).optional(), priority: z.nativeEnum(Priority).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query);
  const where: Prisma.TicketWhereInput = { status: q.status, priority: q.priority };
  if (!isStaff(req.user!.role)) where.requesterId = req.user!.id;
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));

ticketsRouter.get('/:id', asyncHandler(async (req, res) => {
  const t = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { category: true, attachments: true, auditLogs: { orderBy: { createdAt: 'asc' } } },
  });
  if (!t) throw new HttpError(404, 'Ticket not found');
  if (!isStaff(req.user!.role) && t.requesterId !== req.user!.id) throw new HttpError(403, 'Access denied.');
  res.json(t);
}));

// FR-04..FR-08: classify, prioritize, assign, investigate, resolve, close
ticketsRouter.put('/:id', requireRole('AGENT', 'ADMIN'), asyncHandler(async (req, res) => {
  const b = z.object({
    status: z.nativeEnum(S).optional(), agentId: z.number().int().optional(),
    priority: z.nativeEnum(Priority).optional(), categoryId: z.number().int().optional(),
    resolutionNotes: z.string().optional(),
  }).parse(req.body);
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  if (t.status === 'CLOSED') throw new HttpError(409, 'This ticket is closed. Open a new ticket for a recurring issue.'); // BR-03

  const data: Prisma.TicketUncheckedUpdateInput = {};
  if (b.priority) data.priority = b.priority;
  if (b.categoryId) {
    if (!(await prisma.category.findFirst({ where: { id: b.categoryId, isActive: true } }))) throw new HttpError(400, 'Invalid category');
    data.categoryId = b.categoryId;
  }
  if (b.resolutionNotes !== undefined) data.resolutionNotes = b.resolutionNotes;
  if (b.agentId) {
    if (!(await prisma.user.findFirst({ where: { id: b.agentId, role: 'AGENT', isActive: true } }))) throw new HttpError(400, 'Invalid agent');
    data.assignedAgentId = b.agentId; data.assignedAt = new Date();
  }

  const next = b.status ?? (b.agentId && t.status === 'OPEN' ? 'ASSIGNED' : undefined);
  if (next) {
    if (!NEXT[t.status].includes(next)) throw new HttpError(409, `Cannot move ticket from ${t.status} to ${next}`);
    const category = (data.categoryId as number | undefined) ?? t.categoryId;
    if ((next === 'ASSIGNED' || next === 'IN_PROGRESS') && !category) throw new HttpError(400, 'A category is required first (BR-01)');
    if (next === 'ASSIGNED' && !data.assignedAgentId && !t.assignedAgentId) {
      data.assignedAgentId = req.user!.id; data.assignedAt = new Date(); // agent self-assigns (UC-02)
    }
    if (next === 'RESOLVED' || next === 'CLOSED') {
      const notes = (data.resolutionNotes as string | undefined) ?? t.resolutionNotes ?? '';
      if (alnum(notes) < 20) throw new HttpError(400, 'A resolution note of at least 20 alphanumeric characters is required (BR-02)');
      if (next === 'RESOLVED') data.resolvedAt = new Date(); else data.closedAt = new Date();
    }
    data.status = next;
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'Nothing to update');

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.ticket.update({ where: { id: t.id }, data });
    await tx.auditLog.create({ data: {
      ticketId: t.id, actorId: req.user!.id, action: next ? 'STATUS_CHANGED' : 'TICKET_UPDATED',
      oldValue: { status: t.status, priority: t.priority, categoryId: t.categoryId, assignedAgentId: t.assignedAgentId },
      newValue: { status: u.status, priority: u.priority, categoryId: u.categoryId, assignedAgentId: u.assignedAgentId },
    } });
    if (next) await tx.notification.create({ data: { userId: t.requesterId, ticketId: t.id, message: `Ticket ${t.id} is now ${u.status}` } }); // FR-17
    return u;
  });
  res.json(updated);
}));

// BR-03: the only write allowed after closure is the satisfaction rating
ticketsRouter.put('/:id/rating', requireRole('EMPLOYEE'), asyncHandler(async (req, res) => {
  const { rating } = z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body);
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t || t.requesterId !== req.user!.id) throw new HttpError(404, 'Ticket not found');
  if (t.status !== 'CLOSED') throw new HttpError(409, 'Only closed tickets can be rated');
  res.json(await prisma.ticket.update({ where: { id: t.id }, data: { satisfactionRating: rating } }));
}));
