import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { troubleshootWithAi } from '../services/vectorStore';

export const aiRouter = Router();
aiRouter.use(authenticate);

const querySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  top_k: z.number().int().min(1).max(10).optional().default(3),
  ticketId: z.string().optional(),
});

aiRouter.post('/query', asyncHandler(async (req, res) => {
  const body = querySchema.parse(req.body);
  const started = Date.now();
  const result = await troubleshootWithAi(body.title, body.description, body.top_k ?? 3);
  const latencyMs = Date.now() - started;

  const outcome =
    result.resolved_by_ai && !result.should_escalate
      ? 'DEFLECTED'
      : result.should_escalate
        ? 'ESCALATED'
        : 'REJECTED';

  const interaction = await prisma.aiInteraction.create({
    data: {
      userId: req.user!.id,
      ticketId: body.ticketId ?? null,
      querySanitized: `${body.title}\n${body.description}`,
      answer: result.suggestion ?? result.escalation_reason,
      citations: result.sources as unknown as object,
      similarityScore: result.sources[0]?.similarity_score ?? null,
      modelUsed: null,
      outcome: outcome as 'DEFLECTED' | 'ESCALATED' | 'REJECTED',
      latencyMs,
    },
  });

  res.json({ ...result, interactionId: interaction.id });
}));

const feedbackSchema = z.object({
  interactionId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});

aiRouter.post('/feedback', asyncHandler(async (req, res) => {
  const body = feedbackSchema.parse(req.body);
  const interaction = await prisma.aiInteraction.findUnique({ where: { id: body.interactionId } });
  if (!interaction || interaction.userId !== req.user!.id) {
    throw new HttpError(404, 'Interaction not found');
  }
  const feedback = await prisma.aiFeedback.create({
    data: {
      interactionId: body.interactionId,
      userId: req.user!.id,
      rating: body.rating,
      comment: body.comment ?? null,
    },
  });
  res.status(201).json({ id: feedback.id });
}));