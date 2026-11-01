/**
 * One-time upgrade for leads saved before the timeline existed (npm run migrate:timeline).
 * Turns each lead's logged steps and old notes into timeline entries, then removes the old notes field.
 * Safe to run more than once: entries keep their ids and existing ones are skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { legacyTimeline, type LegacyLeadDocument } from '../src/stores/legacy.js';

if (existsSync('.env')) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) process.env[key] ??= value;
}
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL (in server/.env) to the database to upgrade.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

try {
  const leads = (await prisma.lead.findRaw({
    options: { projection: { _id: 1, notes: 1, activity: 1 } },
  })) as unknown as LegacyLeadDocument[];

  let created = 0;
  for (const lead of leads) {
    const entries = legacyTimeline(lead);
    if (entries.length === 0) continue;
    const existing = await prisma.interaction.findMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      select: { id: true },
    });
    const taken = new Set(existing.map((row) => row.id));
    const fresh = entries.filter((entry) => !taken.has(entry.id));
    if (fresh.length) await prisma.interaction.createMany({ data: fresh });
    created += fresh.length;
  }

  await prisma.$runCommandRaw({
    update: 'leads',
    updates: [{ q: { notes: { $exists: true } }, u: { $unset: { notes: '' } }, multi: true }],
  });
  console.log(`Checked ${leads.length} leads and added ${created} timeline entries.`);
} finally {
  await prisma.$disconnect();
}
