import { Router } from 'express';
import type { Stores } from '../stores/types.js';
import { todaysQueue } from './queue.js';

/** Mounted at /api/daily behind requireAuth. */
export function createDailyRouter(stores: Stores, clock: () => Date) {
  const router = Router();
  router.get('/', async (_req, res) => {
    res.json(await todaysQueue(stores, clock()));
  });
  return router;
}
