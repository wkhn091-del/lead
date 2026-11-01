import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

/** One shared client (and connection pool) for the whole process. */
export const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
