import { config } from '../config.js';
import type { Stores } from './types.js';

/** The database's name in a connection string: …mongodb.net/omek_leads?retryWrites=true is omek_leads */
export const databaseName = (url: string) => url.replace(/^[^/]*\/\/[^/]*\/?/, '').split('?')[0];

const CONNECT_ATTEMPTS = 5;
const CONNECT_PAUSE_MS = 3000;

/** What usually stops a connection, said so it can be fixed */
function connectionHint(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/auth|credential|password/i.test(text)) return 'Check the user name and password in DATABASE_URL (Atlas: Database Access).';
  if (/ENOTFOUND|querySrv|getaddrinfo/i.test(text)) return 'Check the cluster address in DATABASE_URL.';
  if (/timed? ?out|Server selection|ECONNREFUSED|ETIMEDOUT/i.test(text)) {
    return 'Allow this server to reach the cluster (Atlas: Network Access, 0.0.0.0/0 on hosts without a fixed IP).';
  }
  return 'Check DATABASE_URL.';
}

/**
 * Connects to MongoDB, where everything is kept: leads with their steps and deal terms, the timeline, recordings'
 * details, coaching, training and Prospector searches. There is no other storage, so the server only starts once
 * the database answers: a server that can't save is never left taking requests, and nothing written to it is lost
 * when it restarts or a new version is deployed.
 */
export async function openStores(): Promise<{ stores: Stores; close: () => Promise<void> }> {
  const [{ prisma }, { createPrismaStores }] = await Promise.all([import('../db.js'), import('./prisma.js')]);
  const stores = createPrismaStores(prisma);
  const name = databaseName(config.databaseUrl);
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$connect();
      await stores.leads.ping();
      console.log(`MongoDB: connected to the "${name}" database, ${await prisma.lead.count()} leads stored.`);
      break;
    } catch (error) {
      if (attempt < CONNECT_ATTEMPTS) {
        console.warn(`MongoDB didn't answer (try ${attempt} of ${CONNECT_ATTEMPTS}); trying again in ${CONNECT_PAUSE_MS / 1000}s.`);
        await new Promise((resolve) => setTimeout(resolve, CONNECT_PAUSE_MS));
        continue;
      }
      console.error(`The server can't start: the MongoDB database "${name}" in DATABASE_URL didn't answer. ${connectionHint(error)}`, error);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(1);
    }
  }
  return { stores, close: () => prisma.$disconnect() };
}
