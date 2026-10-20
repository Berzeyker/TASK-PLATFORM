import { Router } from 'express';
import { ArticleStatus as A, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { syncArticleIndex } from '../services/vectorStore';

export const kbRouter = Router();
kbRouter.use(authenticate);

// Lifecycle from the To-Be analysis: Draft -> Under Review -> Approved -> Published -> Archived
const NEXT: Record<A, A[]> = {
  DRAFT: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['DRAFT', 'APPROVED'],
  APPROVED: ['DRAFT', 'PUBLISHED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};
const isEmployee = (role: Role) => role === 'EMPLOYEE';
const tagsSchema = z.array(z.string().trim().min(1).max(30)).max(10).default([]).transform((t) => [...new Set(t.map((x) => x.toLowerCase()))]);
const listSelect = { id: true, title: true, status: true, tags: true, categoryId: true, authorId: true, version: true, createdAt: true, publishedAt: true } as const;

// FR-09: keyword search ranked by relevance. Employees only see published, employee-visible articles.
kbRouter.get('/search', asyncHandler(async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
  const where: Prisma.KbArticleWhereInput = {
    status: 'PUBLISHED',
    ...(isEmployee(req.user!.role) ? { visibilityRole: 'EMPLOYEE' } : {}),
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
      { tags: { has: q.toLowerCase() } },
    ],
  };
  const rows = await prisma.kbArticle.findMany({ where, take: 50 });
  const needle = q.toLowerCase();
  const hits = (s: string) => s.toLowerCase().split(needle).length - 1;
  const ranked = rows
    .map((a) => ({ a, score: hits(a.title) * 5 + (a.tags.includes(needle) ? 3 : 0) + Math.min(hits(a.content), 5) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 20)
    .map(({ a, score }) => ({ id: a.id, title: a.title, tags: a.tags, categoryId: a.categoryId, snippet: a.content.slice(0, 200), score }));
  res.json(ranked);
}));

// Management list (all statuses), without the article body
kbRouter.get('/articles', requireRole('AGENT', 'MANAGER', 'ADMIN'), asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.nativeEnum(A).optional() }).parse(req.query);
  res.json(await prisma.kbArticle.findMany({ where: { status }, select: listSelect, orderBy: { createdAt: 'desc' } }));
}));

kbRouter.get('/articles/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const a = await prisma.kbArticle.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Article not found');
  if (isEmployee(req.user!.role) && (a.status !== 'PUBLISHED' || a.visibilityRole !== 'EMPLOYEE'))
    throw new HttpError(404, 'Article not found');
  res.json(a);
}));

const articleBody = z.object({
  title: z.string().trim().min(5).max(200),
  content: z.string().trim().min(10),
  categoryId: z.number().int().optional(),
  tags: tagsSchema,
  visibilityRole: z.nativeEnum(Role).optional(),
});

// UC-03: author a draft
kbRouter.post('/articles', requireRole('AGENT', 'ADMIN'), asyncHandler(async (req, res) => {
  const b = articleBody.parse(req.body);
  res.status(201).json(await prisma.kbArticle.create({ data: { ...b, authorId: req.user!.id } }));
}));

// Only Drafts are editable; send other articles back to Draft first (keeps published content reviewed)
kbRouter.put('/articles/:id', requireRole('AGENT', 'ADMIN'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = articleBody.partial().parse(req.body);
  const a = await prisma.kbArticle.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Article not found');
  if (req.user!.role !== 'ADMIN' && a.authorId !== req.user!.id) throw new HttpError(403, 'Access denied.');
  if (a.status !== 'DRAFT') throw new HttpError(409, 'Only draft articles can be edited. Return it to Draft first.');
  res.json(await prisma.kbArticle.update({ where: { id }, data: b }));
}));

// Lifecycle transitions. Review, approval and publication need a Manager or Admin who is not the author.
kbRouter.put('/articles/:id/status', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const { status } = z.object({ status: z.nativeEnum(A) }).parse(req.body);
  const a = await prisma.kbArticle.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Article not found');
  const { id: uid, role } = req.user!;
  if (role === 'EMPLOYEE') throw new HttpError(403, 'Access denied.');
  if (!NEXT[a.status].includes(status)) throw new HttpError(409, `Cannot move article from ${a.status} to ${status}`);

  const reviewer = role === 'MANAGER' || role === 'ADMIN';
  const isAuthor = a.authorId === uid;
  if (status === 'UNDER_REVIEW' && !(isAuthor || role === 'ADMIN')) throw new HttpError(403, 'Only the author can submit for review.');
  if (status === 'DRAFT' && !(isAuthor || reviewer)) throw new HttpError(403, 'Access denied.');
  if ((status === 'APPROVED' || status === 'PUBLISHED' || status === 'ARCHIVED') && !reviewer) throw new HttpError(403, 'Access denied.');
  if ((status === 'APPROVED' || status === 'PUBLISHED') && isAuthor && role !== 'ADMIN')
    throw new HttpError(403, 'An article must be validated by someone other than its author.');

  const data: Prisma.KbArticleUncheckedUpdateInput = { status };
  if (status === 'APPROVED') data.reviewerId = uid;
  if (status === 'PUBLISHED') data.publishedAt = new Date();
  if (status === 'DRAFT') data.version = { increment: 1 };
  const updated = await prisma.kbArticle.update({ where: { id }, data });

  // keep the vector store in sync (no-op until the AI service exists)
  if (status === 'PUBLISHED') await syncArticleIndex(id, 'index');
  else if (a.status === 'PUBLISHED') await syncArticleIndex(id, 'remove');
  res.json(updated);
}));
