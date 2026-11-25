import os from 'os';
import path from 'path';
import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './src/tests/support/testEnv';

// `npm test`: runs against a real, separate Postgres (a Neon test branch). loadTestEnv() aborts the run
// if the test DB is missing or is the same database as backend/.env.
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    globalSetup: ['src/tests/support/globalSetup.ts'],
    env: {
      ...loadTestEnv(),
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-not-for-production',
      CORS_ORIGIN: 'http://localhost:5173',
      UPLOAD_DIR: path.join(os.tmpdir(), 'task-test-uploads'),
    },
    fileParallelism: false, // every file shares one database
    testTimeout: 30_000,
    hookTimeout: 180_000, // a Neon branch can take a while to wake up
  },
});
