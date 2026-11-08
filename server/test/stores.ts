import { createMemoryStores } from './memory-stores.js';
import type { Stores } from '../src/stores/types.js';

/** The test database is emptied before each run, so its name must end in _test. */
export function assertTestDatabase(url: string) {
  const name = url.replace(/^[^/]*\/\/[^/]*\/?/, '').split('?')[0];
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${name || 'no database name'}". Point TEST_DATABASE_URL at a database whose name ends in _test.`,
    );
  }
}

export interface TestStores {
  kind: 'in-memory' | 'MongoDB';
  stores: Stores;
  close: () => Promise<void>;
}

/**
 * With TEST_DATABASE_URL set, the tests run against MongoDB through Prisma (the database is emptied first).
 * Without it, they run against in-memory stores that behave the same way.
 */
export async function createTestStores(): Promise<TestStores> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return { kind: 'in-memory', stores: createMemoryStores(), close: async () => {} };

  assertTestDatabase(url);
  const [{ PrismaClient }, { createPrismaStores }] = await Promise.all([
    import('@prisma/client'),
    import('../src/stores/prisma.js'),
  ]);
  const prisma = new PrismaClient({ datasourceUrl: url });
  await prisma.interaction.deleteMany();
  await prisma.media.deleteMany();
  await prisma.coachingReport.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.deletedLead.deleteMany();
  await prisma.dailyQueue.deleteMany();
  await prisma.objectionCard.deleteMany();
  await prisma.objectionVariant.deleteMany();
  await prisma.trainingRun.deleteMany();
  await prisma.prospect.deleteMany();
  await prisma.prospectSearch.deleteMany();
  return { kind: 'MongoDB', stores: createPrismaStores(prisma), close: () => prisma.$disconnect() };
}
