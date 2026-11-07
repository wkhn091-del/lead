import * as Dialog from '@radix-ui/react-dialog';
import { MessageCircle, PencilLine, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { fillTemplate, TEMPLATE_FIELDS, templateFor, type TemplateId } from '../../lib/messages';
import { formatPhone, whatsAppHref } from '../../lib/phone';
import { useLeadStore } from '../../store/leads';
import { useMessages } from '../../store/messages';
import { useUi } from '../../store/ui';
import type { Lead } from '../../types';
import { logWhatsApp } from '../pipeline/actions';
import { Button, buttonStyles } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from '../ui/ResponsiveDialog';
import { inputBase } from '../ui/styles';

/**
 * WhatsApp with a ready message: pick one of your templates (the one for where the lead stands comes first),
 * change the words for this lead if you like, and open the chat; you send it from WhatsApp. Without a lead it
 * edits the templates themselves.
 */
export function WhatsAppDialog() {
  const leadId = useUi((s) => s.whatsAppLeadId);
  const templatesOpen = useUi((s) => s.templatesOpen);
  const close = useUi((s) => s.closeWhatsApp);
  const lead = useLeadStore((s) => (leadId ? (s.leads.find((item) => item.id === leadId) ?? null) : null));
  const open = Boolean(lead) || templatesOpen;
  // What the dialog shows stays while it closes
  const [shown, setShown] = useState<{ lead: Lead | null } | null>(null);
  useEffect(() => {
    if (open) setShown({ lead });
  }, [open, lead]);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      className="sm:w-[min(560px,calc(100vw-48px))]"
    >
      {shown && (shown.lead ? <Compose key={shown.lead.id} lead={lead ?? shown.lead} onDone={close} /> : <Templates onDone={close} />)}
    </ResponsiveDialog>
  );
}

function Compose({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const templates = useMessages((s) => s.templates);
  const openTemplates = useUi((s) => s.openTemplates);
  const [templateId, setTemplateId] = useState<TemplateId>(() => templateFor(lead));
  const text = (id: TemplateId) => fillTemplate(templates.find((item) => item.id === id)?.text ?? '', lead);
  const [message, setMessage] = useState(() => text(templateFor(lead)));
  const href = whatsAppHref(lead.phone, message);

  const pick = (id: TemplateId) => {
    setTemplateId(id);
    setMessage(text(id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="הודעת וואטסאפ"
        description={
          <>
            <bdi>{lead.name}</bdi>
            {lead.phone && (
              <>
                {' · '}
                <span className="ltr inline-block tabular-nums">{formatPhone(lead.phone)}</span>
              </>
            )}
            . ההודעה תחכה לך בוואטסאפ, ושם שולחים אותה.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="תבנית" className="flex flex-wrap gap-1.5">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={template.id === templateId}
              onClick={() => pick(template.id)}
              className={cn(
                'h-8 rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition-colors',
                template.id === templateId ? 'bg-raised text-fg shadow-[0_1px_2px_var(--shadow-soft)] ring-line-strong' : 'text-fg-muted ring-line hover:text-fg',
              )}
            >
              {template.label}
            </button>
          ))}
        </div>
        <label htmlFor="whatsapp-message" className="sr-only">
          ההודעה
        </label>
        <textarea
          id="whatsapp-message"
          dir="auto"
          rows={6}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className={cn(inputBase, 'min-h-36 resize-y px-3.5 py-3 text-base leading-relaxed sm:text-[14.5px]')}
        />
        <button type="button" onClick={openTemplates} className="self-start text-[13px] font-medium text-fg-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
          עריכת התבניות
        </button>
      </DialogBody>
      <DialogFooter>
        <Dialog.Close asChild>
          <Button variant="ghost" className="max-sm:hidden">
            ביטול
          </Button>
        </Dialog.Close>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              logWhatsApp(lead, message);
              onDone();
            }}
            className={buttonStyles({ variant: 'primary', className: 'max-sm:flex-1' })}
          >
            <MessageCircle className="size-4" aria-hidden />
            פתיחה בוואטסאפ
          </a>
        ) : (
          <Button variant="primary" disabled className="max-sm:flex-1" title="אין לליד מספר שאפשר לשלוח אליו וואטסאפ">
            פתיחה בוואטסאפ
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

function Templates({ onDone }: { onDone: () => void }) {
  const templates = useMessages((s) => s.templates);
  const save = useMessages((s) => s.save);
  const reset = useMessages((s) => s.reset);
  const edited = useMessages((s) => s.edited);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="תבניות וואטסאפ"
        description={
          <>
            ההודעות שנפתחות בוואטסאפ, לפי איפה שהליד נמצא. אפשר לכתוב בהן{' '}
            {TEMPLATE_FIELDS.map((field, index) => (
              <span key={field.token}>
                {index > 0 && (index === TEMPLATE_FIELDS.length - 1 ? ' ו-' : ', ')}
                <bdi className="font-medium text-fg">{field.token}</bdi>
              </span>
            ))}
            , והם יוחלפו בפרטים של הליד. התבניות נשמרות במכשיר הזה.
          </>
        }
      />
      <DialogBody className="flex flex-col gap-4">
        {templates.map((template) => (
          <div key={template.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`template-${template.id}`} className="flex items-center gap-1.5 text-[13.5px] font-medium">
                <PencilLine className="size-3.5 text-fg-faint" aria-hidden />
                {template.label}
              </label>
              {edited(template.id) && (
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => reset(template.id)}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  חזרה לנוסח המקורי
                </Button>
              )}
            </div>
            <textarea
              id={`template-${template.id}`}
              dir="auto"
              rows={3}
              // Saved when the field is left: typing doesn't jump the text around
              defaultValue={template.text}
              key={template.text}
              onBlur={(event) => save(template.id, event.target.value)}
              className={cn(inputBase, 'min-h-24 resize-y px-3.5 py-2.5 text-base leading-relaxed sm:text-[14px]')}
            />
          </div>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" className="max-sm:flex-1" onClick={onDone}>
          סיום
        </Button>
      </DialogFooter>
    </div>
  );
}
