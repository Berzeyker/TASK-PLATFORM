// B-02: the login rate limiter (NFR-02). Alone in its file: the limiter lives in memory per process,
// and each test file gets a fresh app instance, so exhausting it here affects no other test.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { uniq } from './support/factory';

describe('POST /auth/login rate limit (30 requests per 15 minutes per client)', () => {
  it('lets 30 requests through, then answers 429 whatever the credentials', async () => {
    const attempt = () => request(app).post('/api/v1/auth/login').send({ email: `nobody-${uniq()}@task.test`, password: 'x' });
    for (let i = 1; i <= 30; i++) expect((await attempt()).status, `request ${i}`).not.toBe(429);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('applies only to login: other routes are not throttled by it', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
