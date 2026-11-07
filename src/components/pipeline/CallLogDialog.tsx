import * as Dialog from '@radix-ui/react-dialog';
import { PhoneCall } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { modKeyLabel } from '../../lib/a11y';
import { cn } from '../../lib/cn';
import { formatPhone, telHref } from '../../lib/phone';
import { OUTCOME_META, pipelineStatus, STAGE_META, STATUS_META } from '../../lib/stages';
import { isOpen } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { useTimeline } from '../../store/timeline';
import { toast } from '../../store/toasts';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';
import { Button, buttonStyles } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from '../ui/ResponsiveDialog';
import { Segmented, type SegmentedOption } from '../ui/Segmented';
import { inputBase } from '../ui/styles';

type Outcome = 'answered' | 'no_answer' | 'advance';

/**
 * "תעד שיחה": a quick note about a call, with how it went, from a card on the board or a lead's profile. Saving it
 * logs the call, which puts a lead still in outreach in "נוצר קשר (שיחה)"; "רוצה הצעה" moves it on to the quote,
 * and at the quote "נסגר!" closes the deal. On a closed deal it's a note on the timeline.
 */
export function CallLogDialog() {
  const callLogId = useUi((s) => s.callLogId);
  const closeCallLog = useUi((s) => s.closeCallLog);
  const lead = useLeadStore((s) => (callLogId ? (s.leads.find((item) => item.id === callLogId) ?? null) : null));
  // On a phone the keyboard would hide how the call went, often all there is to log ("אין מענה")
  const desktop = useMediaQuery('(min-width: 640px)');
  // The lead stays in the dialog while it closes
  const [shown, setShown] = useState<Lead | null>(null);
  useEffect(() => {
    if (lead) setShown(lead);
  }, [lead]);

  return (
    <ResponsiveDialog
      open={Boolean(lead)}
      onOpenChange={(open) => {
        if (!open) closeCallLog();
      }}
      initialFocus={desktop ? 'call-log-note' : undefined}
      className="sm:w-[min(520px,calc(100vw-48px))]"
    >
      {(lead ?? shown) && <CallLogForm key={(lead ?? shown)!.id} lead={(lead ?? shown)!} onDone={closeCallLog} />}
    </ResponsiveDialog>
  );
}

function CallLogForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const act = useLeadStore((s) => s.act);
  const undo = useLeadStore((s) => s.undo);
  const addMessage = useTimeline((s) => s.addMessage);
  const openProfile = useUi((s) => s.openProfile);
  const [outcome, setOutcome] = useState<Outcome>('answered');
  const [note, setNote] = useState('');

  const open = isOpen(lead);
  const quote = lead.stage === 'zoom';
  const tel = telHref(lead.phone);
  const ready = open || note.trim().length > 0;

  const options: SegmentedOption<Outcome>[] = [
    { value: 'answered', label: quote ? 'דיברנו' : 'ענה', icon: OUTCOME_META.answered.icon, tone: OUTCOME_META.answered.tone },
    { value: 'no_answer', label: 'אין מענה', icon: OUTCOME_META.no_answer.icon, tone: OUTCOME_META.no_answer.tone },
    quote
      ? { value: 'advance', label: 'נסגר!', ariaLabel: 'העסקה נסגרה: מעבר לנסגר / לקוח', icon: STAGE_META.closed.icon, tone: STAGE_META.closed.tone }
      : { value: 'advance', label: 'רוצה הצעה', ariaLabel: 'רוצה הצעת מחיר: מעבר להצעת מחיר', icon: STAGE_META.zoom.icon, tone: STAGE_META.zoom.tone },
  ];

  // Where the lead will be, in words, so the board moving it is no surprise
  const moves = pipelineStatus(lead) !== 'contacted';
  const contacted = `״${STATUS_META.contacted.label}״`;
  const where: Record<Outcome, string> = {
    answered: quote ? 'הליד נשאר ב״הצעת מחיר״.' : moves ? `הליד יעבור ל${contacted}.` : `הליד נשאר ב${contacted}.`,
    no_answer: quote
      ? 'הליד נשאר ב״הצעת מחיר״.'
      : `נספר כניסיון ללא מענה, והליד יכול לעלות שוב בעשירייה היומית. ${moves ? `הוא יעבור ל${contacted}.` : `הוא נשאר ב${contacted}.`}`,
    advance: quote ? 'העסקה תסומן כסגורה, ואז רושמים את הסכומים שלה.' : 'הליד יעבור ל״הצעת מחיר״.',
  };

  const save = () => {
    if (!ready) return;
    const body = note.trim();
    if (!open) {
      if (addMessage(lead, 'note', `שיחה: ${body}`)) toast.success('השיחה נרשמה בציר הזמן', lead.name);
      onDone();
      return;
    }
    const result = act(lead.id, outcome, { body, channel: 'call' });
    if (!result) return;
    const closing = outcome === 'advance' && quote;
    const message: Record<Outcome, string> = {
      answered: `השיחה עם ${lead.name} תועדה`,
      no_answer: `תועד: אין מענה אצל ${lead.name}`,
      advance: closing ? `העסקה עם ${lead.name} נסגרה` : `${lead.name} עבר להצעת מחיר`,
    };
    const description: Record<Outcome, string | undefined> = {
      answered: !quote && moves ? `עבר ל${contacted}.` : undefined,
      no_answer: quote ? undefined : moves ? `עבר ל${contacted}, ויכול לעלות שוב בעשירייה היומית.` : 'יכול לעלות שוב בעשירייה היומית.',
      advance: closing ? 'רשמו את סכומי העסקה כדי שייכנסו להכנסות.' : undefined,
    };
    toast.show({
      message: message[outcome],
      description: description[outcome],
      duration: 8000,
      action: { label: 'ביטול', onClick: () => undo(lead.id, result.id) },
    });
    onDone();
    // A closed deal needs its amounts: its profile opens on them
    if (closing) openProfile(lead.id, 'details');
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <DialogHeading
        title="תיעוד שיחה"
        description={
          <>
            <bdi>{lead.name}</bdi>
            {lead.phone && (
              <>
                {' · '}
                <span className="ltr inline-block tabular-nums">{formatPhone(lead.phone)}</span>
              </>
            )}
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3.5">
        {tel && (
          <a href={tel} className={buttonStyles({ size: 'sm', className: 'self-start' })}>
            <PhoneCall className="size-4" aria-hidden />
            חיוג
          </a>
        )}
        {open && (
          <div className="flex flex-col gap-1.5">
            <Segmented label="איך הלכה השיחה" value={outcome} options={options} onChange={setOutcome} />
            <p className="text-[12.5px] text-pretty text-fg-muted" aria-live="polite">
              {where[outcome]}
            </p>
          </div>
        )}
        <label htmlFor="call-log-note" className="sr-only">
          מה נאמר
        </label>
        <textarea
          id="call-log-note"
          dir="auto"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          placeholder={
            outcome === 'no_answer' && open
              ? 'אפשר לכתוב מתי כדאי לנסות שוב, או אם השארת הודעה'
              : 'מה נאמר? מה הם צריכים, על מה הייתה התנגדות, מה הצעד הבא'
          }
          className={cn(inputBase, 'min-h-28 resize-y px-3.5 py-3 text-base leading-relaxed sm:text-[14.5px]')}
        />
      </DialogBody>
      <DialogFooter>
        <Dialog.Close asChild>
          <Button variant="ghost" className="max-sm:hidden">
            ביטול
          </Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={!ready} title={`שמירה (${modKeyLabel}+Enter)`}>
          {open ? 'שמירת השיחה' : 'שמירה בציר הזמן'}
        </Button>
      </DialogFooter>
    </form>
  );
}
