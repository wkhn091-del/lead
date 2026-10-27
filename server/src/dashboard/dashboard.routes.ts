import { Router } from 'express';
import { z } from 'zod';
import { DEAL_HEALTH } from '../coach/schema.js';
import type { CoachingRecord, LatestEntries, Stores } from '../stores/types.js';

/**
 * Mounted at /api/dashboard behind requireAuth. GET / gives the dashboard what the leads list doesn't have: for
 * every lead in play, when it was last touched (any call, meeting, message or note), how its last Zoom went,
 * and the gist of its latest deal analysis (health, next contact, recommended price). The app combines these
 * with the leads it already has into the expected money, the open deals and the reminders.
 */

/** Reports are stored as the AI wrote them; older ones lack the newer fields, so each part is read on its own */
const Gist = z.object({
  dealHealth: z.enum(DEAL_HEALTH).catch('warm'),
  nextCall: z
    .object({
      goal: z.string().catch(''),
      timing: z.string().catch(''),
      inDays: z.number().int().min(0).max(60).nullable().catch(null),
    })
    .catch({ goal: '', timing: '', inDays: null }),
  actionPlan: z.array(z.object({ step: z.string() })).catch([]),
  pricing: z
    .object({
      setupFee: z.number().int().min(0),
      monthlyRetainer: z.number().int().min(0),
      hostingYearly: z.number().int().min(0),
      currency: z.enum(['ILS', 'USD']),
    })
    .nullable()
    .catch(null),
});

function coachingGist(report: CoachingRecord | undefined) {
  if (!report) return null;
  const gist = Gist.safeParse(report.analysis ?? {});
  if (!gist.success) return null;
  const { dealHealth, nextCall, actionPlan, pricing } = gist.data;
  return {
    at: report.createdAt,
    dealHealth,
    nextCall,
    firstStep: actionPlan[0]?.step ?? null,
    pricing,
    sample: report.provider === 'sample',
  };
}

const pulse = (leadId: string, entries: LatestEntries | undefined, report: CoachingRecord | undefined) => ({
  leadId,
  lastEntry: entries?.last ?? null,
  lastZoom: entries?.zoom ?? null,
  coaching: coachingGist(report),
});

export function createDashboardRouter(stores: Stores) {
  const router = Router();

  router.get('/', async (_req, res) => {
    // Leads in play that have something to remember: past their first call, or further along the funnel
    const leads = (await stores.leads.list()).filter((lead) => !lead.archivedAt && (lead.stage !== 'cold_call' || lead.activity.length > 0));
    const ids = leads.map((lead) => lead.id);
    const [entries, reports] = await Promise.all([stores.interactions.latestByLead(ids), stores.coaching.latestForLeads(ids)]);
    res.json({ pulses: ids.map((id) => pulse(id, entries.get(id), reports.get(id))) });
  });

  return router;
}
