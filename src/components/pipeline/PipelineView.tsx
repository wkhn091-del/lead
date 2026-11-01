import { LeadList } from '../LeadList';
import { LeadToolbar } from '../LeadToolbar';
import { FunnelSummary } from './FunnelSummary';

/** Every lead, filtered by stage and campaign, under the funnel summary. */
export function PipelineView() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <FunnelSummary />
      <section aria-labelledby="leads-heading">
        <h2 id="leads-heading" className="sr-only">
          לידים
        </h2>
        <LeadToolbar />
        <LeadList />
      </section>
    </div>
  );
}
