import * as Dialog from '@radix-ui/react-dialog';
import { Compass, Plus, Store, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { modKeyLabel } from '../lib/a11y';
import { cn } from '../lib/cn';
import { useDraft } from '../lib/drafts';
import { isValidEmail } from '../lib/email';
import { prefersReducedMotion } from '../lib/motion';
import { isValidPhone } from '../lib/phone';
import { CHANNEL_OPTIONS } from '../lib/stages';
import { isValidWebsite } from '../lib/website';
import { useLeadStore } from '../store/leads';
import { toast } from '../store/toasts';
import { useUi } from '../store/ui';
import type { NewLeadInput } from '../types';
import { Button, Kbd } from './ui/Button';
import { Field } from './ui/Field';
import { FormSection } from './ui/FormSection';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from './ui/ResponsiveDialog';
import { Segmented } from './ui/Segmented';
import { inputBase, inputSize } from './ui/styles';

export function AddLeadDialog() {
  const open = useUi((s) => s.addOpen);
  const setOpen = useUi((s) => s.setAddOpen);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen} initialFocus="new-lead-name" className="sm:w-[min(720px,calc(100vw-48px))]">
      <NewLeadForm onDone={() => setOpen(false)} />
    </ResponsiveDialog>
  );
}

type FormErrors = Partial<Record<'name' | 'phone' | 'email' | 'website', string>>;

const emptyForm = (): NewLeadInput => ({
  name: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  campaign: '',
  approach: '',
  method: 'call',
  note: '',
});

const TEXT_FIELDS = ['name', 'contactName', 'phone', 'email', 'website', 'campaign', 'approach', 'note'] as const;
const isEmptyForm = (form: NewLeadInput) => !TEXT_FIELDS.some((key) => form[key].trim());

const textareaClass = cn(inputBase, 'block resize-none px-3.5 py-3 text-base leading-relaxed sm:text-[14.5px]');

/**
 * A new lead in three groups, the same ones its Details tab uses: the business and the person to talk to side by
 * side, then the strategy for the first call. A first note for the timeline is one click away.
 */
function NewLeadForm({ onDone }: { onDone: () => void }) {
  const addLead = useLeadStore((s) => s.addLead);
  // Kept on this device as it's typed, so a lead started mid-call survives a closed dialog or a reloaded page
  const [form, setForm, forgetDraft, restored] = useDraft<NewLeadInput>('new-lead', emptyForm, isEmptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [noteOpen, setNoteOpen] = useState(() => Boolean(form.note.trim()));

  const update = <K extends keyof NewLeadInput>(key: K, value: NewLeadInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const found: FormErrors = {};
    if (!form.name.trim()) found.name = 'צריך את שם העסק, כדי שאפשר יהיה למצוא את הליד אחר כך.';
    if (form.website.trim() && !isValidWebsite(form.website.trim())) found.website = 'נא להזין אתר, למשל business.co.il.';
    if (form.phone.trim() && !isValidPhone(form.phone)) found.phone = 'נא להזין מספר טלפון עם 9 ספרות לפחות.';
    if (form.email.trim() && !isValidEmail(form.email.trim())) found.email = 'נא להזין כתובת אימייל, למשל name@business.co.il.';
    setErrors(found);
    const firstError = (['name', 'website', 'phone', 'email'] as const).find((field) => found[field]);
    if (firstError) {
      document.getElementById(`new-lead-${firstError}`)?.focus();
      return;
    }

    const lead = addLead(form);
    forgetDraft();
    const ui = useUi.getState();
    if (ui.query || (ui.stageFilter !== 'all' && ui.stageFilter !== 'cold_call') || (ui.campaignFilter && ui.campaignFilter !== lead.campaign)) {
      ui.resetFilters();
    }
    ui.highlight([lead.id]);
    toast.success('הליד נוסף', lead.name);
    onDone();
    window.setTimeout(() => {
      document
        .getElementById(`lead-${lead.id}`)
        ?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }, 260);
  };

  const fieldClass = (invalid?: string) => cn(inputBase, inputSize, invalid && 'ring-2 ring-danger focus:ring-danger');
  const errorProps = (field: keyof FormErrors) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `new-lead-${field}-error` } : {};

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeading
        title="ליד חדש"
        description="ליד חדש מתחיל בשלב שיחה קרה ונכנס למאגר של העשירייה היומית. רק שם העסק הוא חובה."
      />

      <DialogBody className="space-y-7">
        {restored && !isEmptyForm(form) && (
          <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-field px-3.5 py-2.5 text-[13px] text-fg-muted ring-1 ring-line ring-inset">
            <span>ממשיכים מאיפה שהפסקת: הטופס נשמר במכשיר הזה.</span>
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setNoteOpen(false);
              }}
              className="font-medium text-fg underline decoration-line-strong underline-offset-4"
            >
              ניקוי הטופס
            </button>
          </p>
        )}
        <div className="grid gap-7 md:grid-cols-2 md:gap-x-8">
          <FormSection titleId="new-lead-business" title="העסק" icon={Store}>
            <div className="grid gap-4">
              <Field label="שם העסק" htmlFor="new-lead-name" error={errors.name}>
                <input
                  id="new-lead-name"
                  dir="auto"
                  autoComplete="off"
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="למשל: מוסך הכרמל"
                  {...errorProps('name')}
                  className={fieldClass(errors.name)}
                />
              </Field>
              <Field label="קמפיין / נישה" htmlFor="new-lead-campaign">
                <input
                  id="new-lead-campaign"
                  dir="auto"
                  autoComplete="off"
                  list="campaign-options"
                  value={form.campaign}
                  onChange={(event) => update('campaign', event.target.value)}
                  placeholder="למשל: רופאי שיניים"
                  className={fieldClass()}
                />
              </Field>
              <Field label="האתר הנוכחי" htmlFor="new-lead-website" error={errors.website}>
                <input
                  id="new-lead-website"
                  inputMode="url"
                  autoComplete="off"
                  dir="ltr"
                  value={form.website}
                  onChange={(event) => update('website', event.target.value)}
                  placeholder="business.co.il"
                  {...errorProps('website')}
                  className={cn(fieldClass(errors.website), 'text-right')}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection titleId="new-lead-person" title="איש הקשר" icon={UserRound}>
            <div className="grid gap-4">
              <Field label="איש קשר" htmlFor="new-lead-contact">
                <input
                  id="new-lead-contact"
                  dir="auto"
                  autoComplete="off"
                  value={form.contactName}
                  onChange={(event) => update('contactName', event.target.value)}
                  placeholder="עם מי מדברים"
                  className={fieldClass()}
                />
              </Field>
              <Field label="ערוץ מועדף">
                <Segmented label="ערוץ מועדף" value={form.method} options={CHANNEL_OPTIONS} onChange={(method) => update('method', method)} />
              </Field>
              <Field label="טלפון" htmlFor="new-lead-phone" error={errors.phone}>
                <input
                  id="new-lead-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  dir="ltr"
                  value={form.phone}
                  onChange={(event) => update('phone', event.target.value)}
                  placeholder="05X-XXX-XXXX"
                  {...errorProps('phone')}
                  className={cn(fieldClass(errors.phone), 'text-right')}
                />
              </Field>
              <Field label="אימייל" htmlFor="new-lead-email" error={errors.email}>
                <input
                  id="new-lead-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  dir="ltr"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="name@business.co.il"
                  {...errorProps('email')}
                  className={cn(fieldClass(errors.email), 'text-right')}
                />
              </Field>
            </div>
          </FormSection>
        </div>

        <FormSection titleId="new-lead-strategy" title="אסטרטגיה" icon={Compass}>
          <textarea
            id="new-lead-approach"
            aria-labelledby="new-lead-strategy"
            dir="auto"
            rows={3}
            value={form.approach}
            onChange={(event) => update('approach', event.target.value)}
            placeholder="מה הכאב שלהם, מה להציע, ואיך לפתוח את השיחה"
            className={textareaClass}
          />

          {noteOpen ? (
            <Field label="הערה ראשונה לציר הזמן" htmlFor="new-lead-note" className="mt-4">
              <textarea
                id="new-lead-note"
                autoFocus
                dir="auto"
                rows={2}
                value={form.note}
                onChange={(event) => update('note', event.target.value)}
                placeholder="מאיפה הליד הגיע, ועל מה כבר דיברתם"
                className={textareaClass}
              />
            </Field>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setNoteOpen(true)} className="-ms-2 mt-2.5">
              <Plus className="size-4" aria-hidden />
              הערה ראשונה לציר הזמן
            </Button>
          )}
        </FormSection>
      </DialogBody>

      <DialogFooter>
        <Dialog.Close asChild>
          <Button variant="ghost" className="max-sm:hidden">
            ביטול
          </Button>
        </Dialog.Close>
        <Button type="submit" variant="primary" className="max-sm:flex-1">
          הוספת הליד
          <Kbd className="ms-1 max-sm:hidden">{modKeyLabel} ↵</Kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}
