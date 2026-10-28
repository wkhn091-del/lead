import { useLeadStore } from '../store/leads';
import { useUi } from '../store/ui';
import { LeadDetails } from './LeadDetails';
import { DialogBody, DialogHeading, ResponsiveDialog } from './ui/ResponsiveDialog';
import { leadBadge } from '../lib/stages';

/** A lead's full details in a dialog, opened from the Today view. */
export function LeadModal() {
  const detailsId = useUi((s) => s.detailsId);
  const setDetailsId = useUi((s) => s.setDetailsId);
  const setEditEntryId = useUi((s) => s.setEditEntryId);
  const lead = useLeadStore((s) => s.leads.find((item) => item.id === detailsId));
  const close = () => {
    setDetailsId(null);
    setEditEntryId(null);
  };

  return (
    <ResponsiveDialog open={Boolean(lead)} onOpenChange={(open) => !open && close()} className="sm:w-[min(980px,calc(100vw-48px))]">
      {lead && (
        <div className="flex min-h-0 flex-1 flex-col">
          <DialogHeading
            title={lead.name}
            description={[leadBadge(lead).label, lead.campaign, lead.contactName].filter(Boolean).join(', ')}
          />
          <DialogBody className="px-1 pt-3 sm:px-2">
            <LeadDetails lead={lead} onDeleted={close} />
          </DialogBody>
        </div>
      )}
    </ResponsiveDialog>
  );
}
