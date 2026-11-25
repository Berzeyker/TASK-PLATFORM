import { parse } from 'dotenv';
import fs from 'fs';
import path from 'path';

export type DbUrls = { DATABASE_URL?: string; DIRECT_URL?: string };

const root = path.resolve(__dirname, '../..'); // backend/

/**
 * Two URLs "are the same database" if they share host and database name.
 * Neon serves one branch through a pooled host (ep-xxx-pooler) and a direct host (ep-xxx), so the
 * "-pooler" suffix is ignored: pointing the tests at the main branch's direct URL must still be caught.
 */
export function databaseIdentity(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^([^.]+)-pooler(?=\.|$)/, '$1');
  return `${host}:${u.port || '5432'}${u.pathname}`;
}

/** Throws unless the test database settings are complete and cannot be the main database (B-01: never test on main). */
export function assertSafeTestDatabase(test: DbUrls, main: DbUrls): void {
  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const value = test[key];
    if (!value) {
      throw new Error(
        `Test database is not configured: ${key} is missing. Create backend/.env.test (see .env.test.example) ` +
          'or, in CI, set TEST_DATABASE_URL and TEST_DIRECT_URL. Use a separate Neon branch, never the main one.',
      );
    }
    try {
      new URL(value);
    } catch {
      throw new Error(`Test database ${key} is not a valid URL.`);
    }
  }
  const testIds = [test.DATABASE_URL!, test.DIRECT_URL!].map(databaseIdentity);
  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const value = main[key];
    if (value && testIds.includes(databaseIdentity(value))) {
      throw new Error(
        `Refusing to run: the test database is the same database as ${key} in backend/.env. ` +
          'The suite wipes every table, so it must run on a separate Neon branch.',
      );
    }
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run tests with NODE_ENV=production.');
}

function readEnvFile(file: string): Record<string, string> {
  return fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
}

/**
 * Test DB settings come from backend/.env.test, or from TEST_DATABASE_URL / TEST_DIRECT_URL (CI).
 * They are handed to Vitest through `test.env`, so they are already set when src/config.ts runs
 * `dotenv/config`, and dotenv never overrides a variable that is already set. backend/.env therefore cannot win.
 */
export function loadTestEnv(): { DATABASE_URL: string; DIRECT_URL: string } {
  const file = readEnvFile(path.join(root, '.env.test'));
  const test: DbUrls = {
    DATABASE_URL: file.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
    DIRECT_URL: file.DIRECT_URL ?? process.env.TEST_DIRECT_URL,
  };
  const main = readEnvFile(path.join(root, '.env'));
  assertSafeTestDatabase(test, { DATABASE_URL: main.DATABASE_URL, DIRECT_URL: main.DIRECT_URL });
  return { DATABASE_URL: test.DATABASE_URL!, DIRECT_URL: test.DIRECT_URL! };
}
