import { Router } from 'express';
import { ArticleStatus as A, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, HttpError } from '../utils/http';
import { syncArticleIndex } from '../services/vectorStore';
import { audit, AuditAction } from '../utils/audit';

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
  const created = await prisma.$transaction(async (tx) => {
    const article = await tx.kbArticle.create({ data: { ...b, authorId: req.user!.id } });
    await audit(tx, {
      actorId: req.user!.id, action: AuditAction.KB_ARTICLE_CREATED,
      newValue: { articleId: article.id, title: article.title, status: article.status, categoryId: article.categoryId, visibilityRole: article.visibilityRole },
    });
    return article;
  });
  res.status(201).json(created);
}));

// Only Drafts are editable; send other articles back to Draft first (keeps published content reviewed)
kbRouter.put('/articles/:id', requireRole('AGENT', 'ADMIN'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = articleBody.partial().parse(req.body);
  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.kbArticle.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Article not found');
    if (req.user!.role !== 'ADMIN' && a.authorId !== req.user!.id) throw new HttpError(403, 'Access denied.');
    if (a.status !== 'DRAFT') throw new HttpError(409, 'Only draft articles can be edited. Return it to Draft first.');
    const u = await tx.kbArticle.update({ where: { id }, data: b });

    // Record WHAT changed, not the article text: the body can be long and is already versioned in the article itself.
    const before: Record<string, unknown> = { articleId: id };
    const after: Record<string, unknown> = { articleId: id };
    for (const field of ['title', 'categoryId', 'tags', 'visibilityRole'] as const) {
      if (b[field] !== undefined && JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
        before[field] = a[field];
        after[field] = u[field];
      }
    }
    if (b.content !== undefined && b.content !== a.content) after.contentChanged = true;
    if (Object.keys(after).length > 1) // an edit that changes nothing is not an event
      await audit(tx, {
        actorId: req.user!.id, action: AuditAction.KB_ARTICLE_UPDATED,
        oldValue: before as Prisma.InputJsonObject, newValue: after as Prisma.InputJsonObject,
      });
    return u;
  });
  res.json(updated);
}));

// Lifecycle transitions. Review, approval and publication need a Manager or Admin who is not the author.
kbRouter.put('/articles/:id/status', requireRole('AGENT', 'MANAGER', 'ADMIN'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const { status } = z.object({ status: z.nativeEnum(A) }).parse(req.body);
  const { id: uid, role } = req.user!;
  const { updated, previous } = await prisma.$transaction(async (tx) => {
    const a = await tx.kbArticle.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Article not found');
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
    const u = await tx.kbArticle.update({ where: { id }, data });
    await audit(tx, {
      actorId: uid, action: AuditAction.KB_STATUS_CHANGED,
      oldValue: { articleId: id, status: a.status },
      newValue: { articleId: id, status: u.status, version: u.version, ...(status === 'APPROVED' ? { reviewerId: uid } : {}) },
    });
    return { updated: u, previous: a.status };
  });

  // keep the vector store in sync (no-op until the AI service exists); outside the transaction: it is an external call
  if (status === 'PUBLISHED') await syncArticleIndex(id, 'index');
  else if (previous === 'PUBLISHED') await syncArticleIndex(id, 'remove');
  res.json(updated);
}));
