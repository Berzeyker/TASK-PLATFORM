// B-02: role-based access control (FR-16, NFR-02, TC-SEC-01).
// 1. A permission matrix over EVERY route x EVERY role (and anonymous), checked for completeness against the
//    routes Express actually registers.
// 2. Cross-user access, mass assignment and KB role rules that a coarse role table cannot express.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../prisma';
import { type Actors, auth, loadActors, makeTicket, uniq } from './support/factory';
import { listRoutes, normalize } from './support/routes';

type Principal = 'anonymous' | 'EMPLOYEE' | 'AGENT' | 'MANAGER' | 'ADMIN';
const ROLES: Principal[] = ['EMPLOYEE', 'AGENT', 'MANAGER', 'ADMIN'];
const STAFF: Principal[] = ['AGENT', 'MANAGER', 'ADMIN'];

type Fixtures = { ticketId: string; attachmentId: number; articleId: number; notificationId: number; categoryId: number; userId: number };
type Route = {
  key: string; // "METHOD /api/v1/path/:p"
  path: (f: Fixtures) => string;
  /** 'public' = no token needed; 'authenticated' = any signed-in role; otherwise the allowed roles */
  allowed: 'public' | 'authenticated' | Principal[];
  body?: object; // chosen so an authorized call never succeeds in changing anything (400/404/409), only passes the authorization layer
};

// The permission matrix. Source of truth: the RBAC rules in the SRS / task context, cross-checked with the routers.
// Fine-grained rules (ownership, authorship, "not your own article") are tested separately below.
const MATRIX: Route[] = [
  { key: 'GET /health', path: () => '/health', allowed: 'public' },
  { key: 'POST /api/v1/auth/login', path: () => '/api/v1/auth/login', allowed: 'public', body: {} },
  { key: 'GET /api/v1/auth/me', path: () => '/api/v1/auth/me', allowed: 'authenticated' },

  { key: 'GET /api/v1/tickets', path: () => '/api/v1/tickets', allowed: 'authenticated' },
  { key: 'POST /api/v1/tickets', path: () => '/api/v1/tickets', allowed: ['EMPLOYEE'], body: {} },
  { key: 'GET /api/v1/tickets/:p', path: (f) => `/api/v1/tickets/${f.ticketId}`, allowed: 'authenticated' },
  { key: 'PUT /api/v1/tickets/:p', path: (f) => `/api/v1/tickets/${f.ticketId}`, allowed: ['AGENT', 'ADMIN'], body: {} },
  { key: 'PUT /api/v1/tickets/:p/rating', path: (f) => `/api/v1/tickets/${f.ticketId}/rating`, allowed: ['EMPLOYEE'], body: {} },
  // any signed-in role may reach the handler; it then enforces ownership for employees and the CLOSED rule
  { key: 'POST /api/v1/tickets/:p/attachments', path: (f) => `/api/v1/tickets/${f.ticketId}/attachments`, allowed: 'authenticated' },
  { key: 'POST /api/v1/tickets/:p/convert-to-kb', path: (f) => `/api/v1/tickets/${f.ticketId}/convert-to-kb`, allowed: ['AGENT', 'ADMIN'] },

  { key: 'GET /api/v1/categories', path: () => '/api/v1/categories', allowed: 'authenticated' },
  { key: 'POST /api/v1/categories', path: () => '/api/v1/categories', allowed: ['ADMIN'], body: {} },
  { key: 'PUT /api/v1/categories/:p', path: (f) => `/api/v1/categories/${f.categoryId}`, allowed: ['ADMIN'], body: {} },

  { key: 'GET /api/v1/admin/users', path: () => '/api/v1/admin/users', allowed: ['ADMIN'] },
  { key: 'GET /api/v1/admin/audit', path: () => '/api/v1/admin/audit', allowed: ['ADMIN'] },
  { key: 'POST /api/v1/admin/users', path: () => '/api/v1/admin/users', allowed: ['ADMIN'], body: {} },
  { key: 'PUT /api/v1/admin/users/:p', path: (f) => `/api/v1/admin/users/${f.userId}`, allowed: ['ADMIN'], body: {} },
  { key: 'GET /api/v1/users', path: () => '/api/v1/users', allowed: STAFF },

  { key: 'GET /api/v1/notifications', path: () => '/api/v1/notifications', allowed: 'authenticated' },
  { key: 'PUT /api/v1/notifications/read-all', path: () => '/api/v1/notifications/read-all', allowed: 'authenticated' },
  { key: 'PUT /api/v1/notifications/:p/read', path: (f) => `/api/v1/notifications/${f.notificationId}/read`, allowed: 'authenticated' },

  { key: 'GET /api/v1/metrics', path: () => '/api/v1/metrics', allowed: ['MANAGER', 'ADMIN'] },
  { key: 'GET /api/v1/attachments/:p', path: (f) => `/api/v1/attachments/${f.attachmentId}`, allowed: 'authenticated' },

  { key: 'GET /api/v1/kb/search', path: () => '/api/v1/kb/search?q=vpn', allowed: 'authenticated' },
  { key: 'GET /api/v1/kb/articles', path: () => '/api/v1/kb/articles', allowed: STAFF },
  { key: 'GET /api/v1/kb/articles/:p', path: (f) => `/api/v1/kb/articles/${f.articleId}`, allowed: 'authenticated' },
  { key: 'POST /api/v1/kb/articles', path: () => '/api/v1/kb/articles', allowed: ['AGENT', 'ADMIN'], body: {} },
  { key: 'PUT /api/v1/kb/articles/:p', path: (f) => `/api/v1/kb/articles/${f.articleId}`, allowed: ['AGENT', 'ADMIN'], body: {} },
  { key: 'PUT /api/v1/kb/articles/:p/status', path: (f) => `/api/v1/kb/articles/${f.articleId}/status`, allowed: STAFF, body: { status: 'NOT_A_STATUS' } },
];

let a: Actors;
let f: Fixtures;
beforeAll(async () => {
  a = await loadActors();
  const ticket = await makeTicket(a); // owned by `employee`, OPEN, categorized
  const attachment = await prisma.attachment.create({ data: { ticketId: ticket.id, fileName: 'x.txt', mimeType: 'text/plain', sizeBytes: 1, storagePath: 'missing-file', uploadedBy: a.employee.id } });
  const article = await prisma.kbArticle.create({ data: { title: `Matrix article ${uniq()}`, content: 'Some article content here.', authorId: a.agent.id } }); // a DRAFT by `agent`
  const note = await prisma.notification.create({ data: { userId: a.employee.id, ticketId: ticket.id, message: 'hello' } });
  f = { ticketId: ticket.id, attachmentId: attachment.id, articleId: article.id, notificationId: note.id, categoryId: a.hardware.id, userId: a.employee2.id };
});

const send = (method: string, path: string, who: Principal, body?: object) => {
  let r = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()](path);
  if (who !== 'anonymous') r = r.set('Authorization', auth(roleActor(who)));
  return body ? r.send(body) : r;
};
const roleActor = (who: Exclude<Principal, 'anonymous'>) => ({ EMPLOYEE: a.employee, AGENT: a.agent, MANAGER: a.manager, ADMIN: a.admin })[who];

describe('permission matrix', () => {
  it('lists every route the app registers (a new route without a matrix entry fails here)', () => {
    const registered = listRoutes(app);
    const documented = MATRIX.map((r) => normalize(r.key.replace(' ', ' '))).sort();
    expect(registered).toEqual(documented);
  });

  const cases = MATRIX.flatMap((route) => (['anonymous', ...ROLES] as Principal[]).map((who) => [route.key, who, route] as const));

  it.each(cases)('%s as %s', async (_key, who, route) => {
    const [method] = route.key.split(' ');
    const res = await send(method, route.path(f), who, route.body);
    const isPublic = route.allowed === 'public';
    const permitted = isPublic || (who !== 'anonymous' && (route.allowed === 'authenticated' || route.allowed.includes(who)));

    if (permitted) {
      // Authorization let the request through. What follows (200, 400, 404, 409...) is the handler's business.
      expect([401, 403], `${route.key} as ${who} should pass the authorization layer, got ${res.status}`).not.toContain(res.status);
    } else if (who === 'anonymous') {
      expect(res.status).toBe(401);
    } else {
      // Signed in, wrong role: must be an outright 403, decided BEFORE the handler looks at the resource,
      // so a 404-vs-403 difference cannot be used to probe which ids exist.
      expect(res.status, `${route.key} as ${who}`).toBe(403);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/passwordhash/i);
  });
});

describe('what the matrix cannot express: users reaching each other\'s data', () => {
  it('an employee only gets their own notifications, and cannot mark someone else\'s as read', async () => {
    const mine = await prisma.notification.create({ data: { userId: a.employee.id, message: `mine ${uniq()}` } });
    const theirs = await prisma.notification.create({ data: { userId: a.employee2.id, message: `theirs ${uniq()}` } });
    const list = await request(app).get('/api/v1/notifications').set('Authorization', auth(a.employee));
    const ids = list.body.items.map((n: { id: number }) => n.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);

    expect((await request(app).put(`/api/v1/notifications/${theirs.id}/read`).set('Authorization', auth(a.employee))).status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).isRead).toBe(false);

    await request(app).put('/api/v1/notifications/read-all').set('Authorization', auth(a.employee));
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).isRead).toBe(false); // read-all only touches the caller's rows
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).isRead).toBe(true);
  });

  it('GET /users: only an admin may list non-agents', async () => {
    for (const who of ['agent', 'manager'] as const) {
      expect((await request(app).get('/api/v1/users?role=EMPLOYEE').set('Authorization', auth(a[who]))).status).toBe(403);
      expect((await request(app).get('/api/v1/users?role=ADMIN').set('Authorization', auth(a[who]))).status).toBe(403);
      expect((await request(app).get('/api/v1/users').set('Authorization', auth(a[who]))).status).toBe(200);
    }
    expect((await request(app).get('/api/v1/users?role=EMPLOYEE').set('Authorization', auth(a.admin))).status).toBe(200);
  });

  it('GET /categories?includeInactive=true is admin only', async () => {
    for (const who of ['employee', 'agent', 'manager'] as const) {
      expect((await request(app).get('/api/v1/categories?includeInactive=true').set('Authorization', auth(a[who]))).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/categories?includeInactive=true').set('Authorization', auth(a.admin))).status).toBe(200);
  });
});

describe('mass assignment: client-supplied fields that must be ignored', () => {
  it('POST /tickets ignores id, status, priority, requesterId, assignment and timestamps', async () => {
    const res = await request(app).post('/api/v1/tickets').set('Authorization', auth(a.employee)).send({
      title: `Mass assignment ${uniq()}`, description: 'Trying to set fields I should not control.', categoryId: a.hardware.id,
      id: 'TCK-FAKE', status: 'CLOSED', priority: 'CRITICAL', requesterId: a.admin.id, assignedAgentId: a.agent.id,
      resolutionNotes: 'x'.repeat(40), satisfactionRating: 5, assignedAt: '2020-01-01T00:00:00Z', closedAt: '2020-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^TCK-\d{8}-[0-9A-F]{6}$/);
    expect(res.body).toMatchObject({ status: 'OPEN', priority: 'MEDIUM', requesterId: a.employee.id, assignedAgentId: null, resolutionNotes: null, satisfactionRating: null, assignedAt: null, closedAt: null });
  });

  it('PUT /tickets/:id cannot change the requester, id or timestamps', async () => {
    const t = await makeTicket(a);
    const res = await request(app).put(`/api/v1/tickets/${t.id}`).set('Authorization', auth(a.agent)).send({
      priority: 'HIGH', requesterId: a.employee2.id, id: 'TCK-HIJACK', createdAt: '2000-01-01T00:00:00Z', closedAt: '2000-01-01T00:00:00Z',
    });
    expect(res.status).toBe(200);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ priority: 'HIGH', requesterId: a.employee.id });
    expect(after.closedAt).toBeNull();
    expect(after.createdAt.getTime()).toBe(t.createdAt.getTime());
  });

  it('POST /admin/users: the role is chosen by the admin, and the new account starts active with a hashed password', async () => {
    const res = await request(app).post('/api/v1/admin/users').set('Authorization', auth(a.admin)).send({
      email: `fresh-${uniq()}@task.test`, fullName: 'Fresh User', role: 'AGENT', password: 'a-long-enough-password', isActive: false, failedLoginCount: -5,
    });
    expect(res.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ role: 'AGENT', isActive: true, failedLoginCount: 0 });
    expect(row.passwordHash).not.toContain('a-long-enough-password');
  });

  it('PUT /admin/users/:id never applies an injected email or password hash', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: a.employee2.id } });
    const res = await request(app).put(`/api/v1/admin/users/${a.employee2.id}`).set('Authorization', auth(a.admin))
      .send({ fullName: 'Renamed Legitimately', email: 'hijack@task.test', passwordHash: 'injected-hash', failedLoginCount: 99 });
    expect([200, 400]).toContain(res.status); // either rejecting or ignoring the extra fields is safe; applying them is not
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.employee2.id } });
    expect(after.email).toBe(before.email);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.failedLoginCount).toBe(before.failedLoginCount);
  });

  it('POST /kb/articles ignores authorId, status, reviewer and publication fields', async () => {
    const res = await request(app).post('/api/v1/kb/articles').set('Authorization', auth(a.agent)).send({
      title: `Injected article ${uniq()}`, content: 'Some article content here.',
      authorId: a.admin.id, status: 'PUBLISHED', reviewerId: a.manager.id, publishedAt: '2020-01-01T00:00:00Z', version: 99,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ authorId: a.agent.id, status: 'DRAFT', reviewerId: null, publishedAt: null, version: 1 });
  });
});

describe('knowledge base role rules (FR-09, FR-16)', () => {
  const draft = async (author = a.agent) => (await prisma.kbArticle.create({ data: { title: `KB ${uniq()}`, content: 'Some article content here.', authorId: author.id } }));
  const setStatus = (id: number, status: string, who: Parameters<typeof auth>[0]) =>
    request(app).put(`/api/v1/kb/articles/${id}/status`).set('Authorization', auth(who)).send({ status });
  const view = (id: number, who: Parameters<typeof auth>[0]) => request(app).get(`/api/v1/kb/articles/${id}`).set('Authorization', auth(who));

  it('employees see only published, employee-visible articles: drafts, internal and archived ones answer 404', async () => {
    const d = await draft();
    const internal = await prisma.kbArticle.create({ data: { title: `Internal ${uniq()}`, content: 'Agents only content.', authorId: a.agent.id, status: 'PUBLISHED', visibilityRole: 'AGENT' } });
    const open = await prisma.kbArticle.create({ data: { title: `Open ${uniq()}`, content: 'Everyone content here.', authorId: a.agent.id, status: 'PUBLISHED', visibilityRole: 'EMPLOYEE' } });
    const archived = await prisma.kbArticle.create({ data: { title: `Old ${uniq()}`, content: 'Archived content here.', authorId: a.agent.id, status: 'ARCHIVED', visibilityRole: 'EMPLOYEE' } });
    expect((await view(d.id, a.employee)).status).toBe(404);
    expect((await view(internal.id, a.employee)).status).toBe(404);
    expect((await view(archived.id, a.employee)).status).toBe(404);
    expect((await view(open.id, a.employee)).status).toBe(200);
    for (const article of [d, internal, open]) expect((await view(article.id, a.agent)).status).toBe(200); // staff see everything
  });

  it('only the author (or an admin) can edit a draft', async () => {
    const d = await draft(a.agent);
    const edit = (who: Parameters<typeof auth>[0]) => request(app).put(`/api/v1/kb/articles/${d.id}`).set('Authorization', auth(who)).send({ title: `Edited ${uniq()}` });
    expect((await edit(a.agent2)).status).toBe(403);
    expect((await edit(a.manager)).status).toBe(403);
    expect((await edit(a.employee)).status).toBe(403);
    expect((await edit(a.agent)).status).toBe(200);
    expect((await edit(a.admin)).status).toBe(200);
  });

  it('employees cannot change article status, and get the same 403 whether or not the article exists (no id probing)', async () => {
    const d = await draft();
    const real = await setStatus(d.id, 'UNDER_REVIEW', a.employee);
    const missing = await setStatus(99999999, 'UNDER_REVIEW', a.employee);
    expect(real.status).toBe(403);
    expect(missing.status).toBe(403);
    expect((await prisma.kbArticle.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('DRAFT');
  });

  it('review workflow: author submits; a non-author reviewer approves and publishes; authors cannot validate their own work', async () => {
    const d = await draft(a.agent);
    expect((await setStatus(d.id, 'UNDER_REVIEW', a.agent2)).status).toBe(403); // only the author submits
    expect((await setStatus(d.id, 'UNDER_REVIEW', a.agent)).status).toBe(200);
    expect((await setStatus(d.id, 'APPROVED', a.agent2)).status).toBe(403); // agents are never reviewers
    expect((await setStatus(d.id, 'APPROVED', a.agent)).status).toBe(403);
    expect((await setStatus(d.id, 'APPROVED', a.manager)).status).toBe(200);
    expect(await prisma.kbArticle.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'APPROVED', reviewerId: a.manager.id });
    expect((await setStatus(d.id, 'PUBLISHED', a.agent)).status).toBe(403);
    expect((await setStatus(d.id, 'PUBLISHED', a.manager)).status).toBe(200);
    expect((await prisma.kbArticle.findUniqueOrThrow({ where: { id: d.id } })).publishedAt).not.toBeNull();
    expect((await view(d.id, a.employee)).status).toBe(200); // now visible to employees
    expect((await setStatus(d.id, 'ARCHIVED', a.agent)).status).toBe(403);
    expect((await setStatus(d.id, 'ARCHIVED', a.admin)).status).toBe(200);
    expect((await view(d.id, a.employee)).status).toBe(404); // and hidden again
  });

  it('a manager who wrote the draft cannot approve it, but an admin can (single-admin deployments)', async () => {
    const d = await prisma.kbArticle.create({ data: { title: `Manager draft ${uniq()}`, content: 'Some article content here.', authorId: a.manager.id, status: 'UNDER_REVIEW' } });
    expect((await setStatus(d.id, 'APPROVED', a.manager)).status).toBe(403);
    const byAdmin = await prisma.kbArticle.create({ data: { title: `Admin draft ${uniq()}`, content: 'Some article content here.', authorId: a.admin.id, status: 'UNDER_REVIEW' } });
    expect((await setStatus(byAdmin.id, 'APPROVED', a.admin)).status).toBe(200);
  });
});
