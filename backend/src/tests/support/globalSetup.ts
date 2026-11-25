import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { loadTestEnv } from './testEnv';

const backendDir = path.resolve(__dirname, '../..');
const run = (args: string[], env: NodeJS.ProcessEnv) =>
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: backendDir, env, stdio: 'inherit' });

/** Runs once before the suite: apply migrations, empty every table, run the seed. Test database only. */
export default async function setup() {
  const testDb = loadTestEnv(); // throws if this could be the main database
  const env = { ...process.env, ...testDb, NODE_ENV: 'test' };

  console.log('\n[tests] applying migrations to the test database…');
  run(['prisma', 'migrate', 'deploy'], env);

  // an explicit datasource, so this client can only ever talk to the URL that passed the safety check
  const prisma = new PrismaClient({ datasources: { db: { url: testDb.DATABASE_URL } } });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) {
      const list = tables.map((t) => `"${t.tablename}"`).join(', ');
      console.log(`[tests] resetting ${tables.length} tables…`);
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('[tests] seeding…');
  run(['tsx', 'prisma/seed.ts'], env);

  return () => {
    fs.rmSync(path.join(os.tmpdir(), 'task-test-uploads'), { recursive: true, force: true });
  };
}
