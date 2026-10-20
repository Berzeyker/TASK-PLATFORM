import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { Prisma, Priority, TicketStatus as S } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncGuard, asyncHandler, HttpError } from '../utils/http';
import { config } from '../config';
import { newTicketId } from '../utils/ticketId';

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// Allowed transitions. CLOSED is terminal (BR-03).
const NEXT: Record<S, S[]> = {
  OPEN: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS', 'RESOLVED'], IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'REOPENED'], REOPENED: ['ASSIGNED'], CLOSED: [],
};
// Never select passwordHash: expose only what the UI needs
const withPeople = {
  category: { select: { id: true, name: true } },
  requester: { select: { id: true, fullName: true, email: true } },
  assignedAgent: { select: { id: true, fullName: true } },
} as const;
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
    prisma.ticket.findMany({ where, include: withPeople, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));

ticketsRouter.get('/:id', asyncHandler(async (req, res) => {
  const t = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { ...withPeople, attachments: true, auditLogs: { orderBy: { createdAt: 'asc' } } },
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

// ---------- FR-02: attachments ----------
fs.mkdirSync(config.uploadDir, { recursive: true });
const ALLOWED: Record<string, { ext: string[]; check: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['.pdf'], check: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  'image/png': { ext: ['.png'], check: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  'image/jpeg': { ext: ['.jpg', '.jpeg'], check: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  'text/plain': { ext: ['.txt'], check: (b) => !b.includes(0) },
};
const upload = multer({
  storage: multer.diskStorage({ destination: config.uploadDir, filename: (_r, _f, cb) => cb(null, randomUUID()) }),
  limits: { fileSize: config.maxUploadBytes, files: 5 },
  fileFilter: (_req, file, cb) => {
    const rule = ALLOWED[file.mimetype];
    const ok = rule && rule.ext.includes(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new HttpError(400, 'Invalid file format or file size exceeds 10MB limit.'));
  },
});

// Authorize BEFORE any file is written to disk
const canAttach = asyncGuard(async (req) => {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  if (!isStaff(req.user!.role) && t.requesterId !== req.user!.id) throw new HttpError(403, 'Access denied.');
  if (t.status === 'CLOSED') throw new HttpError(409, 'This ticket is closed. Open a new ticket for a recurring issue.'); // BR-03
});

ticketsRouter.post('/:id/attachments', canAttach, upload.array('files', 5), asyncHandler(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(400, 'No file received (field name: files)');
  // The MIME type comes from the client, so also verify the file's real content
  const bad = files.filter((f) => {
    const head = Buffer.alloc(1024);
    const fd = fs.openSync(f.path, 'r');
    const n = fs.readSync(fd, head, 0, 1024, 0);
    fs.closeSync(fd);
    return !ALLOWED[f.mimetype].check(head.subarray(0, n));
  });
  if (bad.length) {
    files.forEach((f) => fs.rmSync(f.path, { force: true }));
    throw new HttpError(400, 'Invalid file format or file size exceeds 10MB limit.');
  }
  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const f of files) {
      rows.push(await tx.attachment.create({ data: {
        ticketId: req.params.id, fileName: path.basename(f.originalname), mimeType: f.mimetype,
        sizeBytes: f.size, storagePath: f.filename, uploadedBy: req.user!.id,
      } }));
    }
    await tx.auditLog.create({ data: { ticketId: req.params.id, actorId: req.user!.id, action: 'ATTACHMENT_ADDED', newValue: { files: rows.map((r) => r.fileName) } } });
    return rows;
  });
  res.status(201).json(created);
}));

// ---------- FR-08 / FR-18: convert a resolution into a draft KB article ----------
ticketsRouter.post('/:id/convert-to-kb', requireRole('AGENT', 'ADMIN'), asyncHandler(async (req, res) => {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) throw new HttpError(404, 'Ticket not found');
  if ((t.status !== 'RESOLVED' && t.status !== 'CLOSED') || !t.resolutionNotes)
    throw new HttpError(409, 'Only resolved tickets with resolution notes can be converted');
  if (await prisma.kbArticle.findFirst({ where: { sourceTicketId: t.id } }))
    throw new HttpError(409, 'This ticket was already converted to an article');
  const article = await prisma.$transaction(async (tx) => {
    const a = await tx.kbArticle.create({ data: {
      title: t.title.length >= 5 ? t.title : `${t.title} (resolution)`,
      content: `## Problem\n\n${t.description}\n\n## Resolution\n\n${t.resolutionNotes}\n`,
      categoryId: t.categoryId, sourceTicketId: t.id, authorId: req.user!.id,
      visibilityRole: 'AGENT', // internal until a reviewer decides who may see it
    } });
    await tx.auditLog.create({ data: { ticketId: t.id, actorId: req.user!.id, action: 'CONVERTED_TO_KB', newValue: { articleId: a.id } } });
    return a;
  });
  res.status(201).json(article);
}));
