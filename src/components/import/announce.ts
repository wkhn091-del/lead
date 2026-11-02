import { appConfig } from '../../config';
import { prefersReducedMotion } from '../../lib/motion';
import { useLeadStore } from '../../store/leads';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';

/**
 * After an import, from a table or from JSON: the new leads are highlighted in the list (with filters cleared, so
 * they show), and a toast says how many came in, with an Undo that deletes them all.
 */
export function announceImport(leads: readonly Lead[]) {
  if (leads.length === 0) return;
  const ids = leads.map((lead) => lead.id);
  const ui = useUi.getState();
  if (ui.query || ui.stageFilter !== 'all' || ui.campaignFilter) ui.resetFilters();
  ui.highlight(ids);
  toast.show({
    message: leads.length === 1 ? 'ליד אחד יובא' : `יובאו ${leads.length.toLocaleString(appConfig.locale)} לידים`,
    tone: 'success',
    duration: 8000,
    action: {
      label: 'ביטול',
      onClick: () => {
        useLeadStore.getState().removeLeads(ids);
        toast.show({ message: 'הייבוא בוטל' });
      },
    },
  });
  window.setTimeout(() => {
    document.getElementById(`lead-${ids[0]}`)?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, 320);
}
