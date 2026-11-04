import { motion } from 'motion/react';
import { Ellipsis, MessageCircle, PhoneCall, UserRound } from 'lucide-react';
import { cardLine } from '../../lib/board';
import { cn } from '../../lib/cn';
import { formatPhone } from '../../lib/phone';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';
import { buttonStyles } from '../ui/Button';
import { CampaignTag } from '../ui/StatusBadge';
import { logWhatsApp, useWhatsAppLink } from './actions';

const quick = buttonStyles({ size: 'sm', className: 'h-8 min-w-0 flex-1 gap-1 px-2 text-[12.5px]' });

/**
 * A lead on the board: who it is, its latest contact, and the two things done most: "תעד שיחה" (a quick note on
 * the call, which puts it in "נוצר קשר") and "וואטסאפ" (opens the chat with the ready message for where the lead
 * stands, and puts it in "נשלח וואטסאפ"). The name opens the profile; ⋯ has every other action (the command
 * palette, on this lead).
 */
export function LeadCard({ lead }: { lead: Lead }) {
  const highlighted = useUi((s) => s.highlightedIds.has(lead.id));
  const openProfile = useUi((s) => s.openProfile);
  const openCallLog = useUi((s) => s.openCallLog);
  const openPalette = useUi((s) => s.openPalette);
  const archived = Boolean(lead.archivedAt);
  const whatsApp = useWhatsAppLink(lead);

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={cn(
        'min-w-0 rounded-2xl bg-raised p-3 shadow-[0_1px_2px_var(--shadow-soft)] ring-1 ring-line ring-inset transition-shadow hover:ring-line-strong',
        highlighted && 'card-flash',
        archived && 'opacity-75',
      )}
    >
      <div className="flex items-start gap-1">
        <button
          id={`lead-${lead.id}`}
          type="button"
          onClick={() => openProfile(lead.id)}
          className="min-w-0 flex-1 scroll-mt-28 rounded-lg text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span dir="auto" className={cn('block truncate text-start text-[14.5px] font-semibold tracking-[-0.005em]', archived && 'text-fg-muted')}>
            {lead.name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12.5px] text-fg-muted">
            {lead.phone ? (
              <span className="ltr shrink-0 tabular-nums">{formatPhone(lead.phone)}</span>
            ) : (
              <span className="shrink-0 text-fg-faint">בלי טלפון</span>
            )}
            {lead.contactName && (
              <span className="flex min-w-0 items-center gap-1">
                <UserRound className="size-3 shrink-0" aria-hidden />
                <span dir="auto" className="truncate">
                  {lead.contactName}
                </span>
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => openPalette(lead.id)}
          aria-label={`עוד פעולות: ${lead.name}`}
          title="עוד פעולות"
          className={buttonStyles({ variant: 'ghost', size: 'icon', className: '-me-1.5 -mt-1 size-8 rounded-lg' })}
        >
          <Ellipsis className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CampaignTag campaign={lead.campaign} className="h-5 text-[11.5px]" />
        <span className="min-w-0 truncate text-[12px] text-fg-faint">{cardLine(lead)}</span>
      </div>

      {!archived && (
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" onClick={() => openCallLog(lead.id)} className={quick}>
            <PhoneCall className="size-3.5 shrink-0" style={{ color: 'var(--st-answered)' }} aria-hidden />
            <span className="truncate">תעד שיחה</span>
          </button>
          {whatsApp ? (
            <a
              href={whatsApp.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => logWhatsApp(lead, whatsApp.message)}
              className={quick}
              aria-label={`וואטסאפ ל-${lead.name}, עם הודעה מוכנה`}
              title={whatsApp.message}
            >
              <MessageCircle className="size-3.5 shrink-0" style={{ color: 'var(--whatsapp)' }} aria-hidden />
              <span className="truncate">וואטסאפ</span>
            </a>
          ) : (
            <button type="button" disabled className={quick} title="אין לליד מספר שאפשר לשלוח אליו וואטסאפ">
              <MessageCircle className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">וואטסאפ</span>
            </button>
          )}
        </div>
      )}
    </motion.li>
  );
}
