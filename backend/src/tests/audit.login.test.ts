// B-03: login audit (NFR-12). Successful and failed logins are logged, failures with a null actor and the attempted
// email, and NEVER the password. Also covers the B-02 follow-ups: lockout visibility, a fresh count after a lock
// expires, and equalised login timing.
// Own file: POST /auth/login allows 30 requests per process; this file makes 25 (keep it under 30).
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { prisma } from '../prisma';
import { type Actors, auth, loadActors, makeUser, TEST_PASSWORD, uniq } from './support/factory';

let a: Actors;
beforeAll(async () => {
  a = await loadActors();
});

const mark = async () => (await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1 }))[0]?.id ?? 0;
const since = (wm: number) => prisma.auditLog.findMany({ where: { id: { gt: wm } }, orderBy: { id: 'asc' } });
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });

describe('successful logins', () => {
  it('are logged against the user, with the email and no token or password', async () => {
    const user = await makeUser('AGENT');
    const wm = await mark();
    const res = await login(user.email, TEST_PASSWORD); // login 1
    expect(res.status).toBe(200);
    const rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'LOGIN_SUCCEEDED', actorId: user.id, actorType: 'HUMAN', ticketId: null });
    expect(rows[0].newValue).toEqual({ email: user.email });
    expect(JSON.stringify(rows)).not.toContain(res.body.accessToken);
    expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
  });
});

describe('failed logins', () => {
  it.each([
    ['an unknown email', 'unknown_email'],
    ['a wrong password', 'wrong_password'],
    ['an inactive account', 'inactive_account'],
  ] as const)('%s: logged with no actor, the attempted email and a reason (the response stays generic)', async (name, reason) => {
    const active = await makeUser('EMPLOYEE');
    const inactive = await makeUser('EMPLOYEE', { isActive: false });
    const email = reason === 'unknown_email' ? `ghost-${uniq()}@task.test` : reason === 'inactive_account' ? inactive.email : active.email;
    const password = reason === 'wrong_password' ? `wrong-${uniq()}` : TEST_PASSWORD;
    const wm = await mark();
    const res = await login(email, password); // logins 2-4
    expect(res.status, name).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password. Please try again.' }); // the reason is NOT revealed to the caller
    const rows = await since(wm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'LOGIN_FAILED', actorId: null, actorType: 'HUMAN', ticketId: null });
    expect(rows[0].newValue).toMatchObject({ email, reason });
    expect(JSON.stringify(rows)).not.toContain(password);
  });

  it('the attempted email is stored in lower case', async () => {
    const wm = await mark();
    await login(`MiXeD-${uniq()}@Task.Test`, 'whatever-password'); // login 5
    const [row] = await since(wm);
    expect((row.newValue as { email: string }).email).toMatch(/^mixed-[0-9a-f]+@task\.test$/);
  });

  it.each([
    ['not an email', { email: 'not-an-email', password: 'x' }],
    ['an empty password', { email: 'a@task.test', password: '' }],
    ['an email longer than 254 characters', { email: `${'a'.repeat(250)}@task.test`, password: 'x' }],
  ])('a malformed request (%s) is a 400 and is not logged as a login attempt', async (_name, body) => {
    const wm = await mark();
    expect((await login(body.email, body.password)).status).toBe(400); // logins 6-8
    expect(await since(wm)).toHaveLength(0);
  });
});

describe('lockout visibility and behaviour', () => {
  it('logs every failure, the moment the account locks (a system event), and the attempts made while locked', async () => {
    const user = await makeUser('EMPLOYEE');
    const wm = await mark();
    for (let i = 0; i < 5; i++) expect((await login(user.email, `bad-${i}`)).status).toBe(401); // logins 9-13
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(429); // login 14: even the right password is refused
    expect((await login(user.email, 'bad-again')).status).toBe(429); // login 15

    const rows = await since(wm);
    expect(rows.map((r) => r.action)).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'LOGIN_FAILED', 'LOGIN_FAILED']);
    expect(rows.slice(0, 5).map((r) => (r.newValue as { reason: string }).reason)).toEqual(Array(5).fill('wrong_password'));
    expect(rows.slice(6).map((r) => (r.newValue as { reason: string }).reason)).toEqual(['locked', 'locked']);
    expect(rows.slice(6).every((r) => r.actorId === null)).toBe(true);

    const locked = rows[5];
    expect(locked).toMatchObject({ actorType: 'SYSTEM', actorId: null }); // triggered by the system, not by a person
    expect(locked.newValue).toMatchObject({ userId: user.id, email: user.email, failedAttempts: 5 });
    const until = new Date((locked.newValue as { lockedUntil: string }).lockedUntil).getTime() - Date.now();
    expect(until).toBeGreaterThan(14 * 60_000);
    expect(until).toBeLessThanOrEqual(15 * 60_000);
    expect(rows.filter((r) => r.action === 'ACCOUNT_LOCKED')).toHaveLength(1); // locked once, not once per attempt
  });

  it('known accounts carry their userId in the failure record, so an admin can see who is being attacked', async () => {
    const user = await makeUser('EMPLOYEE');
    const wm = await mark();
    await login(user.email, 'nope'); // login 16
    expect((await since(wm))[0].newValue).toMatchObject({ userId: user.id, reason: 'wrong_password' });
  });

  it('once a lock has expired the count starts again: one wrong guess does not lock the account straight away', async () => {
    const user = await makeUser('EMPLOYEE');
    for (let i = 0; i < 5; i++) await login(user.email, `bad-${i}`); // logins 17-21
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // the 15 minutes pass
    const wm = await mark();
    expect((await login(user.email, 'one-more-guess')).status).toBe(401); // login 22
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).toBeNull();
    expect((await since(wm)).map((r) => r.action)).toEqual(['LOGIN_FAILED']); // no new ACCOUNT_LOCKED
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200); // login 23
  });
});

describe('timing: unknown and inactive accounts cost the same as a wrong password', () => {
  it('a password hash is compared even when there is no account to compare against', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const inactive = await makeUser('EMPLOYEE', { isActive: false });
    try {
      compare.mockClear();
      await login(`ghost-${uniq()}@task.test`, 'some-password'); // login 24
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare.mock.calls[0][1]).toMatch(/^\$2[aby]\$/); // against a real-looking hash, not a short-circuit

      compare.mockClear();
      await login(inactive.email, TEST_PASSWORD); // login 25
      expect(compare).toHaveBeenCalledTimes(1);
    } finally {
      compare.mockRestore();
    }
  });
});

describe('the audit log never holds credentials', () => {
  it('no row created in this file contains a password, a hash or a token', async () => {
    const rows = JSON.stringify(await prisma.auditLog.findMany());
    expect(rows).not.toContain(TEST_PASSWORD);
    expect(rows).not.toMatch(/\$2[aby]\$\d{2}\$/);
    expect(rows).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // JWT shape
    expect(rows).not.toMatch(/passwordhash/i);
    // and the attempted passwords used above
    for (const secret of ['one-more-guess', 'bad-0', 'bad-again', 'some-password']) expect(rows).not.toContain(secret);
    expect(auth(a.admin)).toBeTruthy();
  });
});
