// B-02: login lockout (FR-16, NFR-02). Its own file because POST /auth/login is rate limited per process
// (30 requests / 15 min) and every test file gets a fresh limiter, so these ~20 logins cannot trip it.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { prisma } from '../prisma';
import { makeUser, TEST_PASSWORD } from './support/factory';

const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });

describe('lockout (5 failures -> 15 minutes)', () => {
  it('counts consecutive failures only: a success resets the counter', async () => {
    const user = await makeUser('EMPLOYEE');
    for (let i = 0; i < 4; i++) expect((await login(user.email, 'wrong')).status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(4);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('locks on the 5th failure: even the correct password then gets 429 until the lock expires', async () => {
    const user = await makeUser('EMPLOYEE');
    for (let i = 0; i < 5; i++) expect((await login(user.email, 'wrong')).status).toBe(401);

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const minutes = (new Date(locked.lockedUntil as Date).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const blocked = await login(user.email, TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
    expect((await login(user.email, 'wrong again')).status).toBe(429);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(5); // attempts during the lock do not pile up

    // simulate the 15 minutes passing
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('is per account: locking one user does not affect another', async () => {
    const victim = await makeUser('EMPLOYEE');
    const other = await makeUser('EMPLOYEE');
    for (let i = 0; i < 5; i++) await login(victim.email, 'wrong');
    expect((await login(victim.email, TEST_PASSWORD)).status).toBe(429);
    expect((await login(other.email, TEST_PASSWORD)).status).toBe(200);
  });
});
