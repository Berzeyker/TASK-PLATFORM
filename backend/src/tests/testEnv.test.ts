import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase, databaseIdentity } from './support/testEnv';

const main = {
  DATABASE_URL: 'postgresql://u:p@ep-main-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
  DIRECT_URL: 'postgresql://u:p@ep-main-123.us-east-2.aws.neon.tech/neondb?sslmode=require',
};
const test = {
  DATABASE_URL: 'postgresql://u:p@ep-test-456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
  DIRECT_URL: 'postgresql://u:p@ep-test-456.us-east-2.aws.neon.tech/neondb?sslmode=require',
};

describe('test database safety guard', () => {
  it('accepts a separate branch', () => {
    expect(() => assertSafeTestDatabase(test, main)).not.toThrow();
  });

  it('accepts when there is no backend/.env to compare against (CI)', () => {
    expect(() => assertSafeTestDatabase(test, {})).not.toThrow();
  });

  it('refuses when the main pooled URL is reused', () => {
    expect(() => assertSafeTestDatabase({ ...test, DATABASE_URL: main.DATABASE_URL }, main)).toThrow(/same database/);
  });

  it('refuses when the main DIRECT url is used as the test pooled url (pooler suffix ignored)', () => {
    expect(() => assertSafeTestDatabase({ ...test, DATABASE_URL: main.DIRECT_URL }, main)).toThrow(/same database/);
  });

  it('refuses when only DIRECT_URL points at main', () => {
    expect(() => assertSafeTestDatabase({ ...test, DIRECT_URL: main.DIRECT_URL }, main)).toThrow(/same database/);
  });

  it('the same host with a different database name is a different database', () => {
    const other = { ...test, DATABASE_URL: main.DATABASE_URL.replace('/neondb', '/task_test'), DIRECT_URL: main.DIRECT_URL.replace('/neondb', '/task_test') };
    expect(() => assertSafeTestDatabase(other, main)).not.toThrow();
  });

  it('refuses a missing or invalid configuration', () => {
    expect(() => assertSafeTestDatabase({}, main)).toThrow(/not configured/);
    expect(() => assertSafeTestDatabase({ DATABASE_URL: test.DATABASE_URL }, main)).toThrow(/DIRECT_URL is missing/);
    expect(() => assertSafeTestDatabase({ DATABASE_URL: 'nope', DIRECT_URL: 'nope' }, main)).toThrow(/valid URL/);
  });

  it('normalizes pooler hosts', () => {
    expect(databaseIdentity(main.DATABASE_URL)).toBe(databaseIdentity(main.DIRECT_URL));
  });
});
