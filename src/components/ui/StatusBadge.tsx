import { Tag } from 'lucide-react';
import { cn } from '../../lib/cn';
import { CHANNEL_META, leadBadge, toneStyle, type ToneMeta } from '../../lib/stages';
import type { ContactMethod, Lead } from '../../types';

export function ToneBadge({ meta, className }: { meta: ToneMeta; className?: string }) {
  const Icon = meta.icon;
  return (
    <span
      style={toneStyle(meta.tone)}
      className={cn(
        'tone-chip inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full ps-2 pe-2.5 text-[12.5px] font-medium',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {meta.label}
    </span>
  );
}

/** The lead's stage, or "לא רלוונטי" once archived */
export const LeadBadge = ({ lead, className }: { lead: Pick<Lead, 'stage' | 'archivedAt'>; className?: string }) => (
  <ToneBadge meta={leadBadge(lead)} className={className} />
);

export function CampaignTag({ campaign, className }: { campaign: string; className?: string }) {
  if (!campaign) return null;
  return (
    <span
      dir="auto"
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 truncate rounded-md bg-field px-2 text-[12px] font-medium text-fg-muted ring-1 ring-line ring-inset',
        className,
      )}
    >
      <Tag className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{campaign}</span>
    </span>
  );
}

export function ChannelLabel({ method, className }: { method: ContactMethod; className?: string }) {
  const meta = CHANNEL_META[method];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13.5px] text-fg-muted', className)}>
      <Icon className="size-4 shrink-0" style={{ color: meta.tone }} aria-hidden />
      {meta.label}
    </span>
  );
}
