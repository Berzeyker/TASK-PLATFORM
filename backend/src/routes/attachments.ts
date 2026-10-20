import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../prisma';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';

export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);

// FR-02: agents (and the owner) can download evidence
attachmentsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const a = await prisma.attachment.findUnique({ where: { id }, include: { ticket: { select: { requesterId: true } } } });
  if (!a) throw new HttpError(404, 'Attachment not found');
  const staff = req.user!.role !== 'EMPLOYEE';
  if (!staff && a.ticket.requesterId !== req.user!.id) throw new HttpError(403, 'Access denied.');
  const file = path.join(config.uploadDir, path.basename(a.storagePath));
  if (!fs.existsSync(file)) throw new HttpError(404, 'File not found on server');
  res.download(file, a.fileName);
}));
