// B-03: audit trail for tickets, the knowledge base and admin changes (NFR-12), and the admin audit viewer.
// Rows are located with a watermark (the newest id before the action), so tests stay independent on a shared database.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../prisma';
import { type Actors, auth, GOOD_NOTES, loadActors, makeTicket, uniq } from './support/factory';

let a: Actors;
beforeAll(async () => {
  a = await loadActors();
});

type Who = Parameters<typeof auth>[0];
const mark = async () => (await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1 }))[0]?.id ?? 0;
const since = (wm: number) => prisma.auditLog.findMany({ where: { id: { gt: wm } }, orderBy: { id: 'asc' } });
const req = (method: 'get' | 'post' | 'put', path: string, who: Who, body?: object) => {
  const r = request(app)[method](`/api/v1${path}`).set('Authorization', auth(who));
  return body ? r.send(body) : r;
};
const dump = (v: unknown) => JSON.stringify(v);

describe('every ticket change writes exactly one audit row, in the same request', () => {
  it('create, update, status change, upload, rating and convert-to-kb', async () => {
    let wm = await mark();
    const created = await req('post', '/tickets', a.employee, { title: `Audit trail ${uniq()}`, description: 'Checking the audit rows for each step.', categoryId: a.hardware.id });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    let rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'TICKET_CREATED', actorId: a.employee.id, actorType: 'HUMAN', ticketId: id });
    expect(rows[0].newValue).toMatchObject({ status: 'OPEN' });

    wm = await mark();
    await req('put', `/tickets/${id}`, a.agent, { priority: 'HIGH' });
    rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'TICKET_UPDATED', actorId: a.agent.id, ticketId: id });
    expect(rows[0].oldValue).toMatchObject({ priority: 'MEDIUM' });
    expect(rows[0].newValue).toMatchObject({ priority: 'HIGH' });

    wm = await mark();
    await req('put', `/tickets/${id}`, a.agent, { agentId: a.agent.id });
    rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'STATUS_CHANGED', actorId: a.agent.id });
    expect(rows[0].oldValue).toMatchObject({ status: 'OPEN', assignedAgentId: null });
    expect(rows[0].newValue).toMatchObject({ status: 'ASSIGNED', assignedAgentId: a.agent.id });

    wm = await mark();
    const up = await request(app).post(`/api/v1/tickets/${id}/attachments`).set('Authorization', auth(a.employee)).attach('files', Buffer.from('proof'), { filename: 'proof.txt', contentType: 'text/plain' });
    expect(up.status).toBe(201);
    rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'ATTACHMENT_ADDED', actorId: a.employee.id, ticketId: id });
    expect(rows[0].newValue).toMatchObject({ files: ['proof.txt'] });

    await req('put', `/tickets/${id}`, a.agent, { status: 'RESOLVED', resolutionNotes: GOOD_NOTES });
    await req('put', `/tickets/${id}`, a.admin, { status: 'CLOSED' });

    wm = await mark();
    expect((await req('put', `/tickets/${id}/rating`, a.employee, { rating: 4 })).status).toBe(200);
    rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'TICKET_RATED', actorId: a.employee.id, ticketId: id });
    expect(rows[0].oldValue).toMatchObject({ rating: null });
    expect(rows[0].newValue).toMatchObject({ rating: 4 });

    wm = await mark();
    const convert = await req('post', `/tickets/${id}/convert-to-kb`, a.agent);
    expect(convert.status).toBe(201);
    rows = await since(wm);
    expect(rows.map((r) => r.action).sort()).toEqual(['CONVERTED_TO_KB', 'KB_ARTICLE_CREATED']);
    const onTicket = rows.find((r) => r.action === 'CONVERTED_TO_KB')!;
    const onArticle = rows.find((r) => r.action === 'KB_ARTICLE_CREATED')!;
    expect(onTicket).toMatchObject({ ticketId: id, actorId: a.agent.id });
    expect(onTicket.newValue).toMatchObject({ articleId: convert.body.id });
    expect(onArticle).toMatchObject({ ticketId: null, actorId: a.agent.id });
    expect(onArticle.newValue).toMatchObject({ articleId: convert.body.id, status: 'DRAFT', sourceTicketId: id });
  });

  it('a changed rating is logged with the previous value', async () => {
    const t = await makeTicket(a, { status: 'CLOSED', assignedAgentId: a.agent.id, resolutionNotes: GOOD_NOTES });
    await req('put', `/tickets/${t.id}/rating`, a.employee, { rating: 2 });
    const wm = await mark();
    await req('put', `/tickets/${t.id}/rating`, a.employee, { rating: 5 });
    const [row] = await since(wm);
    expect(row.oldValue).toMatchObject({ rating: 2 });
    expect(row.newValue).toMatchObject({ rating: 5 });
  });

  it('requests that fail write no audit rows at all', async () => {
    const open = await makeTicket(a);
    const closed = await makeTicket(a, { status: 'CLOSED', assignedAgentId: a.agent.id, resolutionNotes: GOOD_NOTES });
    const wm = await mark();
    const results = await Promise.all([
      req('post', '/tickets', a.employee, { title: 'no' }), // 400
      req('put', `/tickets/${open.id}`, a.employee, { priority: 'HIGH' }), // 403
      req('put', `/tickets/${open.id}`, a.agent, { status: 'CLOSED' }), // 409 transition
      req('put', `/tickets/${open.id}`, a.agent, { status: 'ASSIGNED', categoryId: 999999 }), // 400
      req('put', `/tickets/${closed.id}`, a.agent, { priority: 'HIGH' }), // 409 closed
      req('put', `/tickets/${open.id}/rating`, a.employee, { rating: 5 }), // 409 not closed
      req('put', `/tickets/${closed.id}/rating`, a.employee2, { rating: 5 }), // 404 not theirs
      req('put', `/tickets/${closed.id}/rating`, a.employee, { rating: 9 }), // 400
      req('post', `/tickets/${open.id}/convert-to-kb`, a.agent), // 409 not resolved
      req('post', `/tickets/${open.id}/convert-to-kb`, a.employee), // 403
      request(app).post(`/api/v1/tickets/${closed.id}/attachments`).set('Authorization', auth(a.agent)).attach('files', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' }), // 409 closed
      request(app).post(`/api/v1/tickets/${open.id}/attachments`).set('Authorization', auth(a.agent)).attach('files', Buffer.from('not a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' }), // 400 fake pdf
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 403, 409, 400, 409, 409, 404, 400, 409, 403, 409, 400]);
    expect(await since(wm)).toHaveLength(0);
  });
});

describe('the log reconstructs who did what on a ticket', () => {
  it('shows every step, in order, with the person who did it, to an admin', async () => {
    const created = await req('post', '/tickets', a.employee, { title: `Reconstruct ${uniq()}`, description: 'Who did what, and when, on this ticket?', categoryId: a.hardware.id });
    const id: string = created.body.id;
    await req('put', `/tickets/${id}`, a.agent, { agentId: a.agent.id, priority: 'HIGH' });
    await req('put', `/tickets/${id}`, a.agent, { agentId: a.agent2.id }); // reassigned to a colleague
    await request(app).post(`/api/v1/tickets/${id}/attachments`).set('Authorization', auth(a.employee)).attach('files', Buffer.from('log'), { filename: 'log.txt', contentType: 'text/plain' });
    await req('put', `/tickets/${id}`, a.agent2, { status: 'IN_PROGRESS' });
    await req('put', `/tickets/${id}`, a.agent2, { status: 'RESOLVED', resolutionNotes: GOOD_NOTES });
    await req('put', `/tickets/${id}`, a.admin, { status: 'CLOSED' });
    await req('put', `/tickets/${id}/rating`, a.employee, { rating: 5 });
    await req('post', `/tickets/${id}/convert-to-kb`, a.agent2);

    const res = await req('get', `/admin/audit?ticketId=${id}&pageSize=100`, a.admin);
    expect(res.status).toBe(200);
    const story = [...res.body.items].reverse().map((i: { action: string; actor: { fullName: string } | null }) => `${i.actor?.fullName}: ${i.action}`);
    expect(story).toEqual([
      `${a.employee.fullName}: TICKET_CREATED`,
      `${a.agent.fullName}: STATUS_CHANGED`, // assigned + prioritized in one step
      `${a.agent.fullName}: TICKET_UPDATED`, // reassigned
      `${a.employee.fullName}: ATTACHMENT_ADDED`,
      `${a.agent2.fullName}: STATUS_CHANGED`,
      `${a.agent2.fullName}: STATUS_CHANGED`,
      `${a.admin.fullName}: STATUS_CHANGED`,
      `${a.employee.fullName}: TICKET_RATED`,
      `${a.agent2.fullName}: CONVERTED_TO_KB`,
    ]);
    const reassigned = res.body.items.find((i: { action: string }) => i.action === 'TICKET_UPDATED');
    expect(reassigned.oldValue.assignedAgentId).toBe(a.agent.id);
    expect(reassigned.newValue.assignedAgentId).toBe(a.agent2.id);
    const timestamps = res.body.items.map((i: { createdAt: string }) => new Date(i.createdAt).getTime());
    expect([...timestamps].sort((x, y) => y - x)).toEqual(timestamps); // newest first
  });

  it("the ticket's own timeline never contains events from outside that ticket", async () => {
    const t = await makeTicket(a);
    await req('put', `/tickets/${t.id}`, a.agent, { priority: 'HIGH' });
    await req('post', '/kb/articles', a.agent, { title: `Unrelated ${uniq()}`, content: 'Unrelated article content.' });
    const detail = await req('get', `/tickets/${t.id}`, a.employee);
    expect(detail.body.auditLogs.map((l: { action: string }) => l.action)).toEqual(['TICKET_UPDATED']);
    expect(detail.body.auditLogs.every((l: { actor: object | null }) => !l.actor || !('fullName' in l.actor))).toBe(true); // employees see roles, not names
  });
});

describe('knowledge base audit trail', () => {
  const article = (who: Who = a.agent) => req('post', '/kb/articles', who, { title: `KB audit ${uniq()}`, content: 'Original article content here.', tags: ['vpn'] });

  it('logs creation with the article id', async () => {
    const wm = await mark();
    const res = await article();
    expect(res.status).toBe(201);
    const rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'KB_ARTICLE_CREATED', actorId: a.agent.id, actorType: 'HUMAN', ticketId: null });
    expect(rows[0].newValue).toMatchObject({ articleId: res.body.id, title: res.body.title, status: 'DRAFT', visibilityRole: 'EMPLOYEE' });
  });

  it('logs an edit with what changed, but never the article body', async () => {
    const created = await article();
    const id = created.body.id;
    const wm = await mark();
    const res = await req('put', `/kb/articles/${id}`, a.agent, { title: `Renamed ${uniq()}`, tags: ['vpn', 'wifi'], content: 'Completely rewritten body that must not be copied into the log.' });
    expect(res.status).toBe(200);
    const rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'KB_ARTICLE_UPDATED', actorId: a.agent.id });
    expect(rows[0].oldValue).toMatchObject({ articleId: id, title: created.body.title, tags: ['vpn'] });
    expect(rows[0].newValue).toMatchObject({ articleId: id, title: res.body.title, tags: ['vpn', 'wifi'], contentChanged: true });
    expect(dump(rows[0])).not.toContain('rewritten body');
    expect(dump(rows[0])).not.toContain('Original article content');
  });

  it('an edit that changes nothing, and an edit that is refused, write no row', async () => {
    const created = await article();
    const wm = await mark();
    expect((await req('put', `/kb/articles/${created.body.id}`, a.agent, { title: created.body.title, tags: ['vpn'] })).status).toBe(200);
    expect((await req('put', `/kb/articles/${created.body.id}`, a.agent2, { title: 'Hijacked title here' })).status).toBe(403);
    expect((await req('put', `/kb/articles/${created.body.id}`, a.employee, { title: 'Hijacked title here' })).status).toBe(403);
    expect(await since(wm)).toHaveLength(0);
  });

  it('logs every status transition: who, from, to, and the reviewer', async () => {
    const created = await article();
    const id = created.body.id;
    const steps: [Who, string][] = [[a.agent, 'UNDER_REVIEW'], [a.manager, 'APPROVED'], [a.manager, 'PUBLISHED'], [a.admin, 'ARCHIVED'], [a.admin, 'DRAFT']];
    const wm = await mark();
    for (const [who, status] of steps) expect((await req('put', `/kb/articles/${id}/status`, who, { status })).status, status).toBe(200);

    const rows = await since(wm);
    expect(rows.map((r) => [r.action, r.actorId])).toEqual(steps.map(([who]) => ['KB_STATUS_CHANGED', who.id]));
    expect(rows.map((r) => [(r.oldValue as { status: string }).status, (r.newValue as { status: string }).status])).toEqual([
      ['DRAFT', 'UNDER_REVIEW'], ['UNDER_REVIEW', 'APPROVED'], ['APPROVED', 'PUBLISHED'], ['PUBLISHED', 'ARCHIVED'], ['ARCHIVED', 'DRAFT'],
    ]);
    for (const r of rows) {
      expect(r.ticketId).toBeNull();
      expect((r.newValue as { articleId: number }).articleId).toBe(id);
      expect((r.oldValue as { articleId: number }).articleId).toBe(id);
    }
    expect(rows[1].newValue).toMatchObject({ reviewerId: a.manager.id });
    expect(rows[4].newValue).toMatchObject({ version: 2 }); // returning to draft starts a new version
  });

  it('refused transitions write no row', async () => {
    const created = await article();
    const id = created.body.id;
    const wm = await mark();
    const refused = await Promise.all([
      req('put', `/kb/articles/${id}/status`, a.employee, { status: 'UNDER_REVIEW' }), // 403 role
      req('put', `/kb/articles/${id}/status`, a.agent2, { status: 'UNDER_REVIEW' }), // 403 not the author
      req('put', `/kb/articles/${id}/status`, a.agent, { status: 'PUBLISHED' }), // 409 skipping review
      req('put', `/kb/articles/${id}/status`, a.agent, { status: 'NOPE' }), // 400
      req('put', '/kb/articles/99999999/status', a.agent, { status: 'UNDER_REVIEW' }), // 404
    ]);
    expect(refused.map((r) => r.status)).toEqual([403, 403, 409, 400, 404]);
    expect(await since(wm)).toHaveLength(0);
  });
});

describe('admin changes are audited without secrets', () => {
  it('user creation, edits and a password reset', async () => {
    const email = `audited-${uniq()}@task.test`;
    const password = `never-log-${uniq()}-${uniq()}`;
    let wm = await mark();
    const created = await req('post', '/admin/users', a.admin, { email, fullName: 'Audited User', role: 'AGENT', password });
    expect(created.status).toBe(201);
    let rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'USER_CREATED', actorId: a.admin.id });
    expect(rows[0].newValue).toMatchObject({ userId: created.body.id, email, role: 'AGENT' });

    wm = await mark();
    await req('put', `/admin/users/${created.body.id}`, a.admin, { role: 'MANAGER', fullName: 'Renamed Audited', password: `${password}-new` });
    rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'USER_UPDATED', actorId: a.admin.id });
    expect(rows[0].oldValue).toMatchObject({ userId: created.body.id, role: 'AGENT', fullName: 'Audited User' });
    expect(rows[0].newValue).toMatchObject({ userId: created.body.id, role: 'MANAGER', fullName: 'Renamed Audited', passwordReset: true });

    wm = await mark();
    await req('put', `/admin/users/${created.body.id}`, a.admin, { isActive: false });
    expect((await since(wm))[0].newValue).toMatchObject({ isActive: false });

    const everything = dump(await prisma.auditLog.findMany());
    expect(everything).not.toContain(password); // neither the initial nor the reset password
    expect(everything).not.toMatch(/\$2[aby]\$\d{2}\$/);
  });

  it('category creation, rename and deactivation', async () => {
    const name = `Audit cat ${uniq()}`;
    let wm = await mark();
    const created = await req('post', '/categories', a.admin, { name });
    expect((await since(wm))[0]).toMatchObject({ action: 'CATEGORY_CREATED', actorId: a.admin.id });
    wm = await mark();
    await req('put', `/categories/${created.body.id}`, a.admin, { name: `${name} v2`, isActive: false });
    const [row] = await since(wm);
    expect(row).toMatchObject({ action: 'CATEGORY_UPDATED', actorId: a.admin.id });
    expect(row.oldValue).toMatchObject({ categoryId: created.body.id, name, isActive: true });
    expect(row.newValue).toMatchObject({ name: `${name} v2`, isActive: false });
  });

  it('refused admin requests write no row', async () => {
    const wm = await mark();
    await req('post', '/admin/users', a.manager, { email: `x-${uniq()}@task.test`, fullName: 'X Y', role: 'ADMIN', password: 'long-enough-password' }); // 403
    await req('put', `/admin/users/${a.admin.id}`, a.admin, { isActive: false }); // 409 self
    await req('put', '/admin/users/99999999', a.admin, { fullName: 'Ghost' }); // 404
    await req('post', '/categories', a.admin, { name: 'Hardware' }); // 409 duplicate
    expect(await since(wm)).toHaveLength(0);
  });
});

describe('GET /admin/audit (admin only)', () => {
  it('filters by action, actor and date; paginates; newest first; names the actor', async () => {
    const t = await makeTicket(a);
    const from = new Date(Date.now() - 1000).toISOString();
    await req('put', `/tickets/${t.id}`, a.agent, { agentId: a.agent.id }); // a STATUS_CHANGED, so the action filter has something to exclude
    for (const priority of ['HIGH', 'LOW', 'CRITICAL']) await req('put', `/tickets/${t.id}`, a.agent, { priority });

    const everything = await req('get', `/admin/audit?ticketId=${t.id}`, a.admin);
    expect(everything.body.total).toBe(4);
    const statusOnly = await req('get', `/admin/audit?action=STATUS_CHANGED&ticketId=${t.id}`, a.admin);
    expect(statusOnly.body.total).toBe(1);
    expect(statusOnly.body.items[0].action).toBe('STATUS_CHANGED');

    const byAction = await req('get', `/admin/audit?action=TICKET_UPDATED&ticketId=${t.id}`, a.admin);
    expect(byAction.status).toBe(200);
    expect(byAction.body).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(byAction.body.items.map((i: { newValue: { priority: string } }) => i.newValue.priority)).toEqual(['CRITICAL', 'LOW', 'HIGH']);
    expect(byAction.body.items[0].actor).toMatchObject({ id: a.agent.id, fullName: a.agent.fullName, role: 'AGENT' });

    const paged = await req('get', `/admin/audit?ticketId=${t.id}&pageSize=3&page=2`, a.admin);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(4);

    const byActor = await req('get', `/admin/audit?ticketId=${t.id}&actorId=${a.agent2.id}`, a.admin);
    expect(byActor.body.total).toBe(0);
    const byDate = await req('get', `/admin/audit?ticketId=${t.id}&from=${encodeURIComponent(from)}`, a.admin);
    expect(byDate.body.total).toBe(4);
    const future = await req('get', `/admin/audit?ticketId=${t.id}&from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`, a.admin);
    expect(future.body.total).toBe(0);
  });

  it.each([
    ['an unknown action', '?action=NOT_A_REAL_ACTION'],
    ['a page size over 100', '?pageSize=101'],
    ['page 0', '?page=0'],
    ['a malformed date', '?from=yesterday-ish'],
    ['a reversed date range', `?from=${encodeURIComponent('2030-01-02T00:00:00Z')}&to=${encodeURIComponent('2030-01-01T00:00:00Z')}`],
    ['a non-numeric actor id', '?actorId=abc'],
  ])('rejects %s (400)', async (_name, query) => {
    expect((await req('get', `/admin/audit${query}`, a.admin)).status).toBe(400);
  });

  it.each(['employee', 'agent', 'manager'] as const)('%s is refused (403)', async (role) => {
    expect((await req('get', '/admin/audit', a[role])).status).toBe(403);
  });

  it('requires a token (401) and never exposes password data', async () => {
    expect((await request(app).get('/api/v1/admin/audit')).status).toBe(401);
    const res = await req('get', '/admin/audit?pageSize=100', a.admin);
    expect(dump(res.body)).not.toMatch(/passwordhash|\$2[aby]\$\d{2}\$/i);
  });
});
