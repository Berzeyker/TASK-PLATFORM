import os from 'os';
import path from 'path';
import { defineConfig } from 'vitest/config';

// `npm run test:offline`: same tests, but prisma is replaced by an in-memory fake. No database needed.
// Good for fast feedback on route logic; it does NOT replace `npm test`.
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    setupFiles: ['src/tests/support/offlineSetup.ts'],
    env: {
      DATABASE_URL: 'postgresql://offline:offline@localhost:5432/offline',
      DIRECT_URL: 'postgresql://offline:offline@localhost:5432/offline',
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-not-for-production',
      CORS_ORIGIN: 'http://localhost:5173',
      UPLOAD_DIR: path.join(os.tmpdir(), 'task-test-uploads-offline'),
    },
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
