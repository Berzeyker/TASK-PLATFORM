import { vi } from 'vitest';

// Offline mode: every test file gets a fresh in-memory database seeded like prisma/seed.ts.
vi.mock('../../prisma', async () => {
  const { createFakePrisma, seedFake } = await import('./fakePrisma');
  const fake = createFakePrisma();
  seedFake(fake.db);
  return { prisma: fake.prisma };
});
