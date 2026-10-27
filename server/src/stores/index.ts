import { config } from '../config.js';
import type { Stores } from './types.js';

/** Connects the configured storage. Prisma loads only when MongoDB is used. */
export async function openStores(): Promise<{ stores: Stores; close: () => Promise<void> }> {
  if (config.storage === 'memory') {
    const { createMemoryStores } = await import('./memory.js');
    console.warn('STORAGE=memory: leads are kept in memory and disappear when the server stops.');
    return { stores: createMemoryStores(), close: async () => {} };
  }
  const [{ prisma }, { createPrismaStores }] = await Promise.all([import('../db.js'), import('./prisma.js')]);
  return { stores: createPrismaStores(prisma), close: () => prisma.$disconnect() };
}
