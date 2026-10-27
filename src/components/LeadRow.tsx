import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import type { Ref } from 'react';
import { cn } from '../lib/cn';
import { dealAmounts } from '../lib/deal';
import { formatRelative } from '../lib/format';
import { EASE_OUT, SPRING } from '../lib/motion';
import { count, NOUNS } from '../lib/hebrew';
import { formatPhone } from '../lib/phone';
import { CHANNEL_META } from '../lib/stages';
import { isCall } from '../lib/workflow';
import { useUi } from '../store/ui';
import type { Lead } from '../types';
import { LeadDetails } from './LeadDetails';
import { CampaignTag, LeadBadge } from './ui/StatusBadge';

/**
 * One lead: a table row on wide screens, a compact card on phones (see .lead-grid in index.css).
 * Clicking it opens the details below.
 */
export function LeadRow({ lead, ref }: { lead: Lead; ref?: Ref<HTMLLIElement> }) {
  const expanded = useUi((s) => s.expandedId === lead.id);
  const highlighted = useUi((s) => s.highlightedIds.has(lead.id));
  const toggleExpanded = useUi((s) => s.toggleExpanded);

  const channel = CHANNEL_META[lead.method];
  const ChannelIcon = channel.icon;
  const lost = Boolean(lead.archivedAt);
  const calls = lead.activity.filter(isCall).length;
  const badgeKey = lead.archivedAt ? 'archived' : lead.stage;
  // The deal's first two amounts: the setup fee, then what comes back every month or year
  const [amount, recurring] = lead.stage === 'closed' ? dealAmounts(lead.deal, lead.currency) : [];
  const rowId = `lead-${lead.id}`;
  const panelId = `${rowId}-details`;

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('border-t border-line transition-colors first:border-t-0', expanded && 'bg-field')}
    >
      <button
        id={rowId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => toggleExpanded(lead.id)}
        className={cn(
          'lead-grid w-full px-4 py-3.5 text-start transition-colors sm:px-5 lg:py-3',
          !expanded && 'hover:bg-field',
          highlighted && 'row-flash',
        )}
      >
        <span className="ga-name min-w-0">
          <span
            dir="auto"
            className={cn(
              'block truncate text-start text-[15px] font-semibold tracking-[-0.005em]',
              lost && 'text-fg-muted',
            )}
          >
            {lead.name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
            <ChannelIcon className="size-3.5 shrink-0 lg:hidden" style={{ color: channel.tone }} aria-label={channel.label} />
            {lead.contactName ? (
              <span dir="auto" className="truncate text-start">
                {lead.contactName}
              </span>
            ) : lead.phone || lead.email ? (
              <span className="ltr truncate">{formatPhone(lead.phone) || lead.email}</span>
            ) : (
              <span className="truncate">אין פרטי קשר</span>
            )}
          </span>
        </span>


        <span className="ga-status relative flex">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={badgeKey}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={SPRING}
              className="flex"
            >
              <LeadBadge lead={lead} />
            </motion.span>
          </AnimatePresence>
        </span>

        <span className={cn('ga-value text-end tabular-nums whitespace-nowrap', lost && 'text-fg-muted')}>
          {amount ? (
            <>
              <span className="block text-[15px] font-semibold">{amount}</span>
              {recurring && <span className="block text-[12px] leading-snug text-fg-muted">{recurring}</span>}
            </>
          ) : (
            <span className="text-[15px] text-fg-faint" aria-label="אין סכומי עסקה">
              —
            </span>
          )}
        </span>

        <span className={cn('ga-meta flex min-w-0 items-center gap-3', !lead.campaign && !calls && 'max-lg:hidden')}>
          {lead.campaign ? <CampaignTag campaign={lead.campaign} /> : <span className="text-[13px] text-fg-faint max-lg:hidden">—</span>}
          <span className="text-[12.5px] text-fg-faint lg:hidden">{calls > 0 && count(calls, NOUNS.call)}</span>
        </span>

        <span className="ga-calls hidden text-[13.5px] tabular-nums text-fg-muted lg:block">
          {calls > 0 ? count(calls, NOUNS.call) : <span className="text-fg-faint">—</span>}
        </span>

        <span className="ga-updated text-end text-[12.5px] whitespace-nowrap tabular-nums text-fg-faint">
          <time dateTime={lead.updatedAt}>{formatRelative(lead.updatedAt)}</time>
        </span>

        <span className="ga-chevron hidden items-center justify-end text-fg-faint lg:flex">
          <ChevronDown
            className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            id={panelId}
            role="region"
            aria-labelledby={rowId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <LeadDetails lead={lead} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
