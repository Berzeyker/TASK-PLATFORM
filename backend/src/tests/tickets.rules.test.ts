// B-01: ticket business rules (BR-01, BR-02, BR-03) and workflow (FR-01, FR-04 to FR-08).
// Runs through the real Express `app` with supertest. `npm test` uses a separate Postgres branch;
// `npm run test:offline` swaps prisma for an in-memory fake.
import fs from 'fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TicketStatus } from '@prisma/client';
import { app } from '../app';
import { config } from '../config';
import { type Actors, auditFor, auth, getTicket, GOOD_NOTES, loadActors, makeTicket, notificationsFor, uniq } from './support/factory';

let a: Actors;
beforeAll(async () => {
  a = await loadActors();
});

type Who = Parameters<typeof auth>[0];
const put = (id: string, body: object, who: Who) => request(app).put(`/api/v1/tickets/${id}`).set('Authorization', auth(who)).send(body);
const get = (path: string, who: Who) => request(app).get(`/api/v1/tickets${path}`).set('Authorization', auth(who));
const post = (body: object, who: Who) => request(app).post('/api/v1/tickets').set('Authorization', auth(who)).send(body);
const upload = (id: string, who: Who) =>
  request(app).post(`/api/v1/tickets/${id}/attachments`).set('Authorization', auth(who))
    .attach('files', Buffer.from('%PDF-1.4\n%evidence\n'), { filename: 'evidence.pdf', contentType: 'application/pdf' });
const rate = (id: string, rating: unknown, who: Who) => request(app).put(`/api/v1/tickets/${id}/rating`).set('Authorization', auth(who)).send({ rating });

describe('FR-01 create ticket', () => {
  const valid = () => ({ title: `Cannot print ${uniq()}`, description: 'The printer on floor 2 shows an error.', categoryId: a.hardware.id });

  it('creates an OPEN ticket with a TCK-YYYYMMDD-XXXXXX id and an audit row', async () => {
    const res = await post(valid(), a.employee);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^TCK-\d{8}-[0-9A-F]{6}$/);
    expect(res.body).toMatchObject({ status: 'OPEN', priority: 'MEDIUM', requesterId: a.employee.id });
    const [created] = await auditFor(res.body.id);
    expect(created).toMatchObject({ action: 'TICKET_CREATED', actorId: a.employee.id });
    expect(created.newValue).toMatchObject({ status: 'OPEN' });
  });

  it.each([
    ['title shorter than 5', { title: 'abcd' }],
    ['title longer than 150', { title: 'x'.repeat(151) }],
    ['description shorter than 10', { description: 'too short' }],
    ['missing category', { categoryId: undefined }],
    ['unknown category', { categoryId: 999999 }],
  ])('rejects %s (400)', async (_name, patch) => {
    const res = await post({ ...valid(), ...patch }, a.employee);
    expect(res.status).toBe(400);
  });

  it('rejects an inactive category (400)', async () => {
    expect((await post({ ...valid(), categoryId: a.retired.id }, a.employee)).status).toBe(400);
  });

  it.each(['agent', 'manager', 'admin'] as const)('only employees create tickets: %s gets 403', async (role) => {
    expect((await post(valid(), a[role])).status).toBe(403);
  });

  it('requires a token (401)', async () => {
    expect((await request(app).post('/api/v1/tickets').send(valid())).status).toBe(401);
  });
});

describe('BR-01 a category is required before ASSIGNED and IN_PROGRESS', () => {
  it('blocks assigning an uncategorized OPEN ticket by agentId (400) and changes nothing', async () => {
    const t = await makeTicket(a, { categoryId: null });
    const res = await put(t.id, { agentId: a.agent.id }, a.agent);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
    expect(await getTicket(t.id)).toMatchObject({ status: 'OPEN', assignedAgentId: null, assignedAt: null });
    expect(await auditFor(t.id)).toHaveLength(0);
    expect(await notificationsFor(t.id)).toHaveLength(0);
  });

  it('blocks a self-assign move to ASSIGNED without a category (400)', async () => {
    const t = await makeTicket(a, { categoryId: null });
    expect((await put(t.id, { status: 'ASSIGNED' }, a.agent)).status).toBe(400);
  });

  it('blocks IN_PROGRESS without a category (400)', async () => {
    const t = await makeTicket(a, { status: 'ASSIGNED', categoryId: null, assignedAgentId: a.agent.id });
    const res = await put(t.id, { status: 'IN_PROGRESS' }, a.agent);
    expect(res.status).toBe(400);
    expect((await getTicket(t.id)).status).toBe('ASSIGNED');
  });

  it('allows it when the category is set in the same request', async () => {
    const t = await makeTicket(a, { categoryId: null });
    const res = await put(t.id, { agentId: a.agent.id, categoryId: a.software.id }, a.agent);
    expect(res.status).toBe(200);
    expect(await getTicket(t.id)).toMatchObject({ status: 'ASSIGNED', categoryId: a.software.id });
  });

  it('allows it once the category was saved earlier', async () => {
    const t = await makeTicket(a, { categoryId: null });
    expect((await put(t.id, { categoryId: a.hardware.id }, a.agent)).status).toBe(200);
    expect((await put(t.id, { agentId: a.agent.id }, a.agent)).status).toBe(200);
  });

  it('rejects an inactive or unknown category (400)', async () => {
    const t = await makeTicket(a);
    expect((await put(t.id, { categoryId: a.retired.id }, a.agent)).status).toBe(400);
    expect((await put(t.id, { categoryId: 999999 }, a.agent)).status).toBe(400);
  });
});

describe('BR-02 resolution notes need 20 letters or digits for RESOLVED and CLOSED', () => {
  const assigned = () => makeTicket(a, { status: 'ASSIGNED', assignedAgentId: a.agent.id });

  it.each([
    ['no notes at all', undefined],
    ['empty notes', ''],
    ['short notes', 'too short'],
    ['19 letters/digits padded with spaces and punctuation (40+ chars)', 'abcd efgh ijkl mnop qrs ... !!! ??? ---'],
    ['only accented letters (the server counts a-z and 0-9 only)', 'ñáéíóú ñáéíóú ñáéíóú ñáéíóú ñáéíóú'],
  ])('blocks RESOLVED with %s (400)', async (_name, notes) => {
    const t = await assigned();
    const res = await put(t.id, notes === undefined ? { status: 'RESOLVED' } : { status: 'RESOLVED', resolutionNotes: notes }, a.agent);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resolution note/i);
    const after = await getTicket(t.id);
    expect(after.status).toBe('ASSIGNED');
    expect(after.resolvedAt).toBeNull();
    expect(after.resolutionNotes).toBeNull(); // the rejected request must not save partial data
    expect(await auditFor(t.id)).toHaveLength(0);
  });

  it('accepts exactly 20 letters/digits and stamps resolvedAt', async () => {
    const t = await assigned();
    const res = await put(t.id, { status: 'RESOLVED', resolutionNotes: 'a'.repeat(20) }, a.agent);
    expect(res.status).toBe(200);
    const after = await getTicket(t.id);
    expect(after).toMatchObject({ status: 'RESOLVED', resolutionNotes: 'a'.repeat(20) });
    expect(after.resolvedAt).not.toBeNull();
  });

  it('uses notes saved by an earlier request when none are sent', async () => {
    const t = await assigned();
    expect((await put(t.id, { resolutionNotes: GOOD_NOTES }, a.agent)).status).toBe(200);
    expect((await put(t.id, { status: 'RESOLVED' }, a.agent)).status).toBe(200);
  });

  it('blocks CLOSED when the stored notes are too short (400), allows it with good notes and stamps closedAt', async () => {
    const t = await makeTicket(a, { status: 'RESOLVED', assignedAgentId: a.agent.id, resolutionNotes: 'short' });
    expect((await put(t.id, { status: 'CLOSED' }, a.agent)).status).toBe(400);
    expect((await getTicket(t.id)).status).toBe('RESOLVED');
    expect((await put(t.id, { status: 'CLOSED', resolutionNotes: GOOD_NOTES }, a.agent)).status).toBe(200);
    const closed = await getTicket(t.id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
  });

  it('does not require notes for other moves (IN_PROGRESS, REOPENED)', async () => {
    const t = await assigned();
    expect((await put(t.id, { status: 'IN_PROGRESS' }, a.agent)).status).toBe(200);
    const r = await makeTicket(a, { status: 'RESOLVED', assignedAgentId: a.agent.id });
    expect((await put(r.id, { status: 'REOPENED' }, a.agent)).status).toBe(200);
  });
});

describe('status transitions', () => {
  const ALL: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
  // The spec's workflow, written out independently of the implementation.
  const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
    OPEN: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS', 'RESOLVED'], IN_PROGRESS: ['RESOLVED'],
    RESOLVED: ['CLOSED', 'REOPENED'], REOPENED: ['ASSIGNED'], CLOSED: [],
  };
  const cases = ALL.flatMap((from) => ALL.map((to) => [from, to, ALLOWED[from].includes(to)] as const));

  // Every ticket starts with a category, an agent (except OPEN) and valid notes, so only the transition itself can fail.
  it.each(cases)('%s -> %s', async (from, to, allowed) => {
    const t = await makeTicket(a, { status: from, assignedAgentId: from === 'OPEN' ? null : a.agent.id, resolutionNotes: GOOD_NOTES });
    const res = await put(t.id, { status: to }, a.agent);
    if (allowed) {
      expect(res.status).toBe(200);
      expect((await getTicket(t.id)).status).toBe(to);
    } else {
      expect(res.status).toBe(409);
      expect((await getTicket(t.id)).status).toBe(from);
      expect(await auditFor(t.id)).toHaveLength(0);
      expect(await notificationsFor(t.id)).toHaveLength(0);
    }
  });

  it('REOPENED -> ASSIGNED keeps working after a full reopen cycle', async () => {
    const t = await makeTicket(a, { status: 'RESOLVED', assignedAgentId: a.agent.id, resolutionNotes: GOOD_NOTES });
    expect((await put(t.id, { status: 'REOPENED' }, a.agent)).status).toBe(200);
    expect((await put(t.id, { status: 'ASSIGNED', agentId: a.agent2.id }, a.agent)).status).toBe(200);
    expect(await getTicket(t.id)).toMatchObject({ status: 'ASSIGNED', assignedAgentId: a.agent2.id });
  });

  it('rejects an unknown status (400), an unknown ticket (404) and an empty update (400)', async () => {
    const t = await makeTicket(a);
    expect((await put(t.id, { status: 'DONE' }, a.agent)).status).toBe(400);
    expect((await put('TCK-00000000-FFFFFF', { priority: 'HIGH' }, a.agent)).status).toBe(404);
    expect((await put(t.id, {}, a.agent)).status).toBe(400);
  });
});

describe('BR-03 CLOSED tickets are read-only (except the rating)', () => {
  const closed = () => makeTicket(a, { status: 'CLOSED', assignedAgentId: a.agent.id, resolutionNotes: GOOD_NOTES });

  it.each([
    ['priority', { priority: 'HIGH' }],
    ['category', { categoryId: 0 }], // valid shape; closure must win over any other check
    ['assignment', { agentId: 0 }],
    ['resolution notes', { resolutionNotes: 'a different set of resolution notes entirely' }],
    ['status', { status: 'REOPENED' }],
  ])('rejects editing %s (409) and writes nothing', async (_name, body) => {
    const t = await closed();
    const before = await getTicket(t.id);
    const res = await put(t.id, body, a.agent);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/closed/i);
    expect(await getTicket(t.id)).toEqual(before);
    expect(await auditFor(t.id)).toHaveLength(0);
  });

  it('rejects an upload (409) and writes no file to disk', async () => {
    const t = await closed();
    const filesBefore = fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir).length : 0;
    const res = await upload(t.id, a.agent);
    expect(res.status).toBe(409);
    const filesAfter = fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir).length : 0;
    expect(filesAfter).toBe(filesBefore);
  });

  it('proves uploads work on an open ticket (so the 409 above is meaningful)', async () => {
    const t = await makeTicket(a);
    const res = await upload(t.id, a.employee);
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ fileName: 'evidence.pdf', mimeType: 'application/pdf' });
    expect((await auditFor(t.id)).map((l) => l.action)).toContain('ATTACHMENT_ADDED');
  });

  it("accepts the requester's satisfaction rating on a closed ticket", async () => {
    const t = await closed();
    const res = await rate(t.id, 5, a.employee);
    expect(res.status).toBe(200);
    expect((await getTicket(t.id)).satisfactionRating).toBe(5);
  });

  it('rejects a rating before closure (409), out of range or not an integer (400), by another employee (404), by staff (403)', async () => {
    const open = await makeTicket(a, { status: 'RESOLVED', assignedAgentId: a.agent.id });
    expect((await rate(open.id, 4, a.employee)).status).toBe(409);
    const t = await closed();
    expect((await rate(t.id, 0, a.employee)).status).toBe(400);
    expect((await rate(t.id, 6, a.employee)).status).toBe(400);
    expect((await rate(t.id, 3.5, a.employee)).status).toBe(400);
    expect((await rate(t.id, 4, a.employee2)).status).toBe(404);
    expect((await rate(t.id, 4, a.agent)).status).toBe(403);
    expect((await getTicket(t.id)).satisfactionRating).toBeNull();
  });
});

describe('RBAC on tickets', () => {
  it.each(['employee', 'manager'] as const)('%s cannot update tickets (403)', async (role) => {
    const t = await makeTicket(a);
    const res = await put(t.id, { priority: 'CRITICAL' }, a[role]);
    expect(res.status).toBe(403);
    expect((await getTicket(t.id)).priority).toBe('MEDIUM');
  });

  it.each(['agent', 'admin'] as const)('%s can update tickets', async (role) => {
    const t = await makeTicket(a);
    expect((await put(t.id, { priority: 'HIGH' }, a[role])).status).toBe(200);
  });

  it('requires a token (401)', async () => {
    const t = await makeTicket(a);
    expect((await request(app).put(`/api/v1/tickets/${t.id}`).send({ priority: 'HIGH' })).status).toBe(401);
  });

  it("an employee cannot read another employee's ticket (403) but can read their own", async () => {
    const t = await makeTicket(a, { requesterId: a.employee2.id });
    expect((await get(`/${t.id}`, a.employee)).status).toBe(403);
    expect((await get(`/${t.id}`, a.employee2)).status).toBe(200);
  });

  it.each(['agent', 'manager', 'admin'] as const)('%s can read any ticket', async (role) => {
    const t = await makeTicket(a, { requesterId: a.employee2.id });
    expect((await get(`/${t.id}`, a[role])).status).toBe(200);
  });

  it("an employee cannot upload to another employee's ticket (403)", async () => {
    const t = await makeTicket(a, { requesterId: a.employee2.id });
    expect((await upload(t.id, a.employee)).status).toBe(403);
  });

  it('the list shows employees only their own tickets, and staff everything', async () => {
    const mine = await makeTicket(a, { requesterId: a.employee.id });
    const theirs = await makeTicket(a, { requesterId: a.employee2.id });
    const asEmployee = await get('?pageSize=100', a.employee);
    expect(asEmployee.status).toBe(200);
    const ids = asEmployee.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(asEmployee.body.items.every((i: { requester: { id: number } }) => i.requester.id === a.employee.id)).toBe(true);
    const asAgent = (await get('?pageSize=100', a.agent)).body.items.map((i: { id: string }) => i.id);
    expect(asAgent).toEqual(expect.arrayContaining([mine.id, theirs.id]));
  });

  it('filters by status and priority, and caps the page size', async () => {
    const t = await makeTicket(a, { priority: 'CRITICAL', status: 'IN_PROGRESS', assignedAgentId: a.agent.id });
    const res = await get('?status=IN_PROGRESS&priority=CRITICAL&pageSize=100', a.agent);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(t.id);
    expect(res.body.items.every((i: { status: string; priority: string }) => i.status === 'IN_PROGRESS' && i.priority === 'CRITICAL')).toBe(true);
    expect((await get('?pageSize=101', a.agent)).status).toBe(400);
    expect((await get('?status=NOPE', a.agent)).status).toBe(400);
  });
});

describe('assignment (FR-05)', () => {
  it('assigning an OPEN ticket by agentId moves it to ASSIGNED and sets assignedAt', async () => {
    const t = await makeTicket(a);
    const res = await put(t.id, { agentId: a.agent.id }, a.agent);
    expect(res.status).toBe(200);
    const after = await getTicket(t.id);
    expect(after).toMatchObject({ status: 'ASSIGNED', assignedAgentId: a.agent.id });
    expect(after.assignedAt).not.toBeNull();
    expect(Date.now() - new Date(after.assignedAt as Date).getTime()).toBeLessThan(60_000);
  });

  it('an agent can self-assign by moving the ticket to ASSIGNED', async () => {
    const t = await makeTicket(a);
    expect((await put(t.id, { status: 'ASSIGNED' }, a.agent)).status).toBe(200);
    const after = await getTicket(t.id);
    expect(after.assignedAgentId).toBe(a.agent.id);
    expect(after.assignedAt).not.toBeNull();
  });

  it('an admin can take a ticket the same way', async () => {
    const t = await makeTicket(a);
    expect((await put(t.id, { status: 'ASSIGNED' }, a.admin)).status).toBe(200);
    expect((await getTicket(t.id)).assignedAgentId).toBe(a.admin.id);
  });

  it('reassigning keeps the status, changes the agent and refreshes assignedAt', async () => {
    const t = await makeTicket(a);
    await put(t.id, { agentId: a.agent.id }, a.agent);
    const first = await getTicket(t.id);
    const res = await put(t.id, { agentId: a.agent2.id }, a.agent);
    expect(res.status).toBe(200);
    const after = await getTicket(t.id);
    expect(after).toMatchObject({ status: 'ASSIGNED', assignedAgentId: a.agent2.id });
    expect(new Date(after.assignedAt as Date).getTime()).toBeGreaterThanOrEqual(new Date(first.assignedAt as Date).getTime());
  });

  it.each([
    ['an employee', () => a.employee.id],
    ['a manager', () => a.manager.id],
    ['an inactive agent', () => a.inactiveAgent.id],
    ['a user that does not exist', () => 999999],
  ])('rejects assigning to %s (400)', async (_name, agentId) => {
    const t = await makeTicket(a);
    const res = await put(t.id, { agentId: agentId() }, a.agent);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent/i);
    expect(await getTicket(t.id)).toMatchObject({ status: 'OPEN', assignedAgentId: null });
  });
});

describe('audit log and notifications (NFR-12, FR-17)', () => {
  it('a status change writes STATUS_CHANGED with who, before and after, and notifies the requester', async () => {
    const t = await makeTicket(a);
    await put(t.id, { agentId: a.agent.id }, a.agent);
    const [entry] = await auditFor(t.id);
    expect(entry).toMatchObject({ action: 'STATUS_CHANGED', actorId: a.agent.id });
    expect(entry.oldValue).toMatchObject({ status: 'OPEN', assignedAgentId: null });
    expect(entry.newValue).toMatchObject({ status: 'ASSIGNED', assignedAgentId: a.agent.id });
    const notes = await notificationsFor(t.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: a.employee.id, isRead: false });
    expect(notes[0].message).toContain('ASSIGNED');
    expect(notes[0].message).toContain(t.id);
  });

  it('a change without a status move writes TICKET_UPDATED and does not notify', async () => {
    const t = await makeTicket(a);
    await put(t.id, { priority: 'HIGH' }, a.agent);
    const [entry] = await auditFor(t.id);
    expect(entry).toMatchObject({ action: 'TICKET_UPDATED', actorId: a.agent.id });
    expect(entry.oldValue).toMatchObject({ priority: 'MEDIUM' });
    expect(entry.newValue).toMatchObject({ priority: 'HIGH' });
    expect(await notificationsFor(t.id)).toHaveLength(0);
  });

  it('rejected requests leave no audit or notification rows', async () => {
    const t = await makeTicket(a, { categoryId: null });
    await put(t.id, { agentId: a.agent.id }, a.agent); // BR-01 -> 400
    await put(t.id, { status: 'CLOSED' }, a.agent); // invalid transition -> 409
    await put(t.id, { priority: 'HIGH' }, a.employee); // RBAC -> 403
    expect(await auditFor(t.id)).toHaveLength(0);
    expect(await notificationsFor(t.id)).toHaveLength(0);
  });

  it('a full lifecycle can be reconstructed: who did what, in order, with one notification per status move', async () => {
    const created = await post({ title: `Lifecycle ${uniq()}`, description: 'Full lifecycle for the audit test.', categoryId: a.hardware.id }, a.employee);
    const id: string = created.body.id;
    expect((await put(id, { agentId: a.agent.id, priority: 'HIGH' }, a.agent)).status).toBe(200);
    expect((await put(id, { status: 'IN_PROGRESS' }, a.agent)).status).toBe(200);
    expect((await put(id, { status: 'RESOLVED', resolutionNotes: GOOD_NOTES }, a.agent)).status).toBe(200);
    expect((await put(id, { status: 'CLOSED' }, a.admin)).status).toBe(200);
    expect((await rate(id, 5, a.employee)).status).toBe(200);

    const log = await auditFor(id);
    expect(log.map((l) => [l.action, l.actorId])).toEqual([
      ['TICKET_CREATED', a.employee.id],
      ['STATUS_CHANGED', a.agent.id],
      ['STATUS_CHANGED', a.agent.id],
      ['STATUS_CHANGED', a.agent.id],
      ['STATUS_CHANGED', a.admin.id],
      ['TICKET_RATED', a.employee.id],
    ]);
    const statuses = log.slice(1, 5).map((l) => (l.newValue as { status: string }).status);
    expect(statuses).toEqual(['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
    expect((await notificationsFor(id)).map((n) => n.message.split(' ').pop())).toEqual(['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
    expect(await getTicket(id)).toMatchObject({ status: 'CLOSED', priority: 'HIGH', satisfactionRating: 5 });
  });
});
