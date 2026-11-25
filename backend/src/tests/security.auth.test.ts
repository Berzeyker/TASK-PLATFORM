// B-02: authentication and transport security (FR-16, NFR-02, TC-SEC-01).
// Covers token handling, the isActive / role-from-database decision, login lockout, user enumeration,
// hardening headers, malformed bodies, and that no response ever leaks a password hash.
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { config } from '../config';
import { prisma } from '../prisma';
import { type Actors, auth, b64url, bearer, loadActors, makeTicket, makeUser, signRaw, TEST_PASSWORD, uniq } from './support/factory';

let a: Actors;
beforeAll(async () => {
  a = await loadActors();
});

const probe = (authorization?: string) => {
  const r = request(app).get('/api/v1/tickets');
  return authorization ? r.set('Authorization', authorization) : r;
};
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });

describe('tokens: anything that is not a valid, current token gets 401', () => {
  const sub = () => String(a.employee.id);
  const cases: [string, () => string | undefined][] = [
    ['no Authorization header', () => undefined],
    ['wrong scheme (Basic)', () => 'Basic dXNlcjpwYXNz'],
    ['empty bearer token', () => 'Bearer '],
    ['garbage token', () => 'Bearer not.a.jwt'],
    ['expired token', () => bearer(signRaw({ role: 'EMPLOYEE' }, config.jwtSecret, { subject: sub(), expiresIn: -10 }))],
    ['signed with the wrong secret', () => bearer(signRaw({ role: 'ADMIN' }, 'some-other-secret', { subject: sub(), expiresIn: '15m' }))],
    ['payload tampered (role -> ADMIN) with the original signature', () => {
      const [h, , sig] = auth(a.employee).slice(7).split('.');
      return bearer(`${h}.${b64url({ sub: sub(), role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 900 })}.${sig}`);
    }],
    ['alg "none" (unsigned) token', () => bearer(`${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: sub(), role: 'ADMIN' })}.`)],
    ['valid secret but a different algorithm (HS512)', () => bearer(signRaw({ role: 'EMPLOYEE' }, config.jwtSecret, { subject: sub(), algorithm: 'HS512', expiresIn: '15m' }))],
    ['no subject claim', () => bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { expiresIn: '15m' }))],
    ['non-numeric subject', () => bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: 'abc', expiresIn: '15m' }))],
    ['negative subject', () => bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: '-1', expiresIn: '15m' }))],
    ['fractional subject', () => bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: '1.5', expiresIn: '15m' }))],
    ['a well-signed token for a user that does not exist', () => bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: '99999999', expiresIn: '15m' }))],
  ];
  it.each(cases)('%s', async (_name, header) => {
    const res = await probe(header());
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.(ts|js):\d+/); // no stack traces
  });

  it('a valid token works', async () => {
    expect((await probe(auth(a.employee))).status).toBe(200);
  });

  it('expired tokens are rejected on every protected area, not just the list', async () => {
    const expired = bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: String(a.admin.id), expiresIn: -1 }));
    for (const path of ['/api/v1/auth/me', '/api/v1/admin/users', '/api/v1/metrics', '/api/v1/kb/articles', '/api/v1/notifications']) {
      expect((await request(app).get(path).set('Authorization', expired)).status, path).toBe(401);
    }
  });
});

describe('revocation: deactivation and role changes take effect immediately (the isActive decision)', () => {
  it('a deactivated user is locked out at once, with the token they already hold', async () => {
    const user = await makeUser('EMPLOYEE');
    const token = auth(user);
    expect((await probe(token)).status).toBe(200);

    const off = await request(app).put(`/api/v1/admin/users/${user.id}`).set('Authorization', auth(a.admin)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await probe(token)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', token)).status).toBe(401);
    expect((await request(app).get('/api/v1/notifications').set('Authorization', token)).status).toBe(401);

    await request(app).put(`/api/v1/admin/users/${user.id}`).set('Authorization', auth(a.admin)).send({ isActive: true });
    expect((await probe(token)).status).toBe(200); // reactivation restores access
  });

  it('the role comes from the database, not from the token: a token that claims ADMIN does not make an employee an admin', async () => {
    const employee = await makeUser('EMPLOYEE');
    const lying = bearer(signRaw({ role: 'ADMIN' }, config.jwtSecret, { subject: String(employee.id), expiresIn: '15m' }));
    expect((await request(app).get('/api/v1/admin/users').set('Authorization', lying)).status).toBe(403);
    expect((await request(app).get('/api/v1/metrics').set('Authorization', lying)).status).toBe(403);
  });

  it('a demotion applies to tokens issued before it', async () => {
    const agent = await makeUser('AGENT');
    const token = auth(agent);
    const ticket = await makeTicket(a);
    expect((await request(app).put(`/api/v1/tickets/${ticket.id}`).set('Authorization', token).send({ priority: 'HIGH' })).status).toBe(200);

    await request(app).put(`/api/v1/admin/users/${agent.id}`).set('Authorization', auth(a.admin)).send({ role: 'EMPLOYEE' });
    expect((await request(app).put(`/api/v1/tickets/${ticket.id}`).set('Authorization', token).send({ priority: 'LOW' })).status).toBe(403);
  });

  it('a promotion applies to tokens issued before it', async () => {
    const employee = await makeUser('EMPLOYEE');
    const token = auth(employee);
    expect((await request(app).get('/api/v1/metrics').set('Authorization', token)).status).toBe(403);
    await request(app).put(`/api/v1/admin/users/${employee.id}`).set('Authorization', auth(a.admin)).send({ role: 'MANAGER' });
    expect((await request(app).get('/api/v1/metrics').set('Authorization', token)).status).toBe(200);
  });
});

describe('login', () => {
  it('returns a 15-minute token for the right user and role, and nothing sensitive', async () => {
    const user = await makeUser('AGENT');
    const res = await login(user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'role']);
    expect(res.body.role).toBe('AGENT');
    const payload = jwt.verify(res.body.accessToken, config.jwtSecret) as jwt.JwtPayload;
    expect(payload.sub).toBe(String(user.id));
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    expect(res.body.accessToken).toBeTruthy();
    expect((await probe(bearer(res.body.accessToken))).status).toBe(200);
  });

  it('unknown email, wrong password and inactive account all give the SAME 401 (no user enumeration)', async () => {
    const active = await makeUser('EMPLOYEE');
    const inactive = await makeUser('EMPLOYEE', { isActive: false });
    const unknown = await login(`nobody-${uniq()}@task.test`, TEST_PASSWORD);
    const wrong = await login(active.email, 'definitely-wrong');
    const off = await login(inactive.email, TEST_PASSWORD);
    for (const res of [unknown, wrong, off]) expect(res.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual(off.body);
  });

  it.each([
    ['no body', undefined],
    ['missing password', { email: 'x@task.test' }],
    ['empty password', { email: 'x@task.test', password: '' }],
    ['malformed email', { email: 'not-an-email', password: 'x' }],
    ['non-string values', { email: { $gt: '' }, password: { $gt: '' } }], // NoSQL-style operator injection attempt
  ])('rejects %s (400)', async (_name, body) => {
    const r = request(app).post('/api/v1/auth/login');
    const res = await (body === undefined ? r : r.send(body));
    expect(res.status).toBe(400);
  });
});

describe('transport hardening', () => {
  it('sends security headers and does not advertise Express', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('CORS: the API only ever authorizes the configured front-end origin', async () => {
    // `cors` with one fixed origin always answers with that origin; a browser then refuses any other site.
    const ok = await request(app).get('/health').set('Origin', config.corsOrigin);
    expect(ok.headers['access-control-allow-origin']).toBe(config.corsOrigin);
    const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBe(config.corsOrigin);
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).not.toBe('*');
    expect(evil.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('malformed JSON is a client error (400), not a server error, and leaks no internals', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|stack|node_modules/);
  });

  it('a body over the 1 MB limit is rejected with 413', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
  });

  it('an unknown route is a 404, not a 500', async () => {
    expect((await request(app).get('/api/v1/definitely-not-a-route')).status).toBe(404);
    expect((await request(app).get('/api/v1/admin')).status).toBe(401); // the admin router answers before anything else: unauthenticated first
  });

  it('SQL-looking input is just data', async () => {
    const res = await request(app).get('/api/v1/kb/search').query({ q: `'; DROP TABLE "User"; --` }).set('Authorization', auth(a.admin));
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: a.admin.id } })).not.toBeNull();
  });
});

describe('no response ever leaks a password hash', () => {
  const SENTINEL = '$2b$04$SENTINELHASHVALUETHATMUSTNEVERAPPEARINANYRESPONSE0123456789';

  it('scans every endpoint that returns user data', async () => {
    // users whose hash is an easy-to-spot sentinel, placed where the API would expose them
    const sEmployee = await makeUser('EMPLOYEE', { passwordHash: `${SENTINEL}E` });
    const sAgent = await makeUser('AGENT', { passwordHash: `${SENTINEL}A` });
    const ticket = await makeTicket(a, { requesterId: sEmployee.id, assignedAgentId: sAgent.id, status: 'ASSIGNED' });
    const draft = await request(app).post('/api/v1/kb/articles').set('Authorization', auth(sAgent)).send({ title: 'Sentinel article', content: 'Some article content here.' });
    expect(draft.status).toBe(201);
    await prisma.notification.create({ data: { userId: sEmployee.id, ticketId: ticket.id, message: 'hello' } });

    const created = await request(app).post('/api/v1/admin/users').set('Authorization', auth(a.admin))
      .send({ email: `made-${uniq()}@task.test`, fullName: 'Made User', role: 'AGENT', password: 'a-long-enough-password' });
    const edited = await request(app).put(`/api/v1/admin/users/${sAgent.id}`).set('Authorization', auth(a.admin)).send({ fullName: 'Sentinel Agent' });
    const realLogin = await makeUser('EMPLOYEE');
    const loggedIn = await login(realLogin.email, TEST_PASSWORD);

    const get = (path: string, who: Parameters<typeof auth>[0]) => request(app).get(path).set('Authorization', auth(who));
    const responses = [
      ['POST /admin/users', created], ['PUT /admin/users/:id', edited], ['POST /auth/login', loggedIn],
      ['GET /auth/me', await get('/api/v1/auth/me', sAgent)],
      ['GET /admin/users', await get('/api/v1/admin/users', a.admin)],
      ['GET /users?role=AGENT', await get('/api/v1/users?role=AGENT', a.admin)],
      ['GET /users?role=EMPLOYEE', await get('/api/v1/users?role=EMPLOYEE', a.admin)],
      ['GET /tickets (admin)', await get('/api/v1/tickets?pageSize=100', a.admin)],
      ['GET /tickets (employee)', await get('/api/v1/tickets', sEmployee)],
      ['GET /tickets/:id (agent)', await get(`/api/v1/tickets/${ticket.id}`, sAgent)],
      ['GET /tickets/:id (employee)', await get(`/api/v1/tickets/${ticket.id}`, sEmployee)],
      ['GET /kb/articles', await get('/api/v1/kb/articles', a.admin)],
      ['GET /kb/articles/:id', await get(`/api/v1/kb/articles/${draft.body.id}`, sAgent)],
      ['GET /notifications', await get('/api/v1/notifications', sEmployee)],
      ['GET /metrics', await get('/api/v1/metrics', a.manager)],
      ['GET /categories', await get('/api/v1/categories', a.admin)],
    ] as const;

    const everyHash = (await prisma.user.findMany({ select: { passwordHash: true } })).map((u) => u.passwordHash).filter((h) => h.length >= 10);
    for (const [name, res] of responses) {
      expect(res.status, `${name} should succeed`).toBeLessThan(300);
      const text = JSON.stringify(res.body);
      expect(text, `${name} exposes a passwordHash field`).not.toMatch(/passwordhash/i);
      expect(text, `${name} contains something shaped like a bcrypt hash`).not.toMatch(/\$2[aby]\$\d{2}\$/);
      for (const hash of everyHash) expect(text.includes(hash), `${name} contains a stored hash`).toBe(false);
    }
    // the scan is only meaningful if the sensitive users really were part of those responses
    expect(JSON.stringify(responses.find(([n]) => n === 'GET /admin/users')![1].body)).toContain(sEmployee.email);
    expect(JSON.stringify(responses.find(([n]) => n === 'GET /tickets/:id (agent)')![1].body)).toContain(sEmployee.email);
    expect(JSON.stringify(responses.find(([n]) => n === 'GET /tickets/:id (employee)')![1].body)).toContain('Sentinel Agent'); // renamed by the PUT above
  });
});
