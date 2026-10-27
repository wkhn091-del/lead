import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { drafts } from '../../lib/drafts';
import { EXAMPLE_PASTE } from '../../lib/import/example';
import { parseImport, type ImportFormat } from '../../lib/import/parse';
import { useUi } from '../../store/ui';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from '../ui/ResponsiveDialog';
import { inputBase } from '../ui/styles';
import { ReviewStep } from './ReviewStep';

/**
 * Kept when the dialog closes, and on this device, so an accidental close or a reload doesn't lose the paste.
 * Cleared after an import.
 */
const DRAFT_KEY = 'import-paste';
const setDraft = (text: string) => (text.trim() ? drafts.write(DRAFT_KEY, text) : drafts.clear(DRAFT_KEY));

export function ImportDialog() {
  const open = useUi((s) => s.importOpen);
  const setOpen = useUi((s) => s.setImportOpen);
  const [locked, setLocked] = useState(false);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={setOpen}
      locked={locked}
      initialFocus="import-text"
      className="sm:w-[min(880px,calc(100vw-48px))]"
    >
      <ImportFlow
        onLockChange={setLocked}
        onClose={(imported) => {
          if (imported) drafts.clear(DRAFT_KEY);
          setLocked(false);
          setOpen(false);
        }}
      />
    </ResponsiveDialog>
  );
}

interface ImportFlowProps {
  onLockChange: (locked: boolean) => void;
  onClose: (imported: boolean) => void;
}

function ImportFlow({ onLockChange, onClose }: ImportFlowProps) {
  const [text, setText] = useState(() => drafts.read<string>(DRAFT_KEY) ?? '');
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  if (step === 'review') {
    return <ReviewStep text={text} onBack={() => setStep('paste')} onLockChange={onLockChange} onClose={onClose} />;
  }
  return (
    <PasteStep
      text={text}
      onChange={(value) => {
        setDraft(value);
        setText(value);
      }}
      onContinue={() => setStep('review')}
    />
  );
}

const FORMAT_NOTE: Record<ImportFormat, string> = {
  spreadsheet: 'נקרא כשורות מגיליון',
  csv: 'נקרא כשורות מופרדות בפסיקים',
  lines: 'נקרא כליד אחד בכל שורה',
  blocks: 'נקרא כליד אחד בכל פסקה',
};

const PLACEHOLDER = [
  'מדביקים כאן. למשל:',
  '',
  'משתלת רותם\tרותם שני\t050-000-0211\t6,800 ₪',
  'סטודיו כנרת - טלי דרור - 052-000-0266 - tali@bluelake.example',
  'מאפיית השכונה | רונית | 054-000-0277',
].join('\n');

interface PasteStepProps {
  text: string;
  onChange: (text: string) => void;
  onContinue: () => void;
}

function PasteStep({ text, onChange, onContinue }: PasteStepProps) {
  const deferred = useDeferredValue(text);
  const result = useMemo(() => parseImport(deferred), [deferred]);
  const count = result.rows.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="ייבוא לידים"
        description="מדביקים שורות מאקסל או מ-Google Sheets, קובץ CSV, או רשימה עם ליד אחד בכל שורה."
      />
      <DialogBody className="flex flex-col gap-3">
        <label htmlFor="import-text" className="sr-only">
          לידים לייבוא
        </label>
        <textarea
          id="import-text"
          autoFocus
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && count > 0) {
              event.preventDefault();
              onContinue();
            }
          }}
          wrap="off"
          spellCheck={false}
          autoComplete="off"
          dir="auto"
          placeholder={PLACEHOLDER}
          className={cn(
            inputBase,
            'min-h-[36dvh] flex-1 resize-none px-4 py-3.5 text-base leading-[1.75] whitespace-pre [tab-size:4] sm:min-h-[320px] sm:text-[14px]',
          )}
        />
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {count > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
              <Sparkles className="size-4 text-focus" aria-hidden />
              <span className="font-semibold">
                {count === 1 ? (
                  'נמצא ליד אחד'
                ) : (
                  <>
                    נמצאו <AnimatedNumber value={count} className="tabular-nums" />
                    <span className="sr-only">{count}</span> לידים
                  </>
                )}
              </span>
              {result.format && <span className="text-fg-muted">{FORMAT_NOTE[result.format]}</span>}
            </p>
          ) : (
            <p className="text-[13.5px] text-pretty text-fg-muted">
              {text.trim()
                ? 'עדיין לא זוהו לידים. כל ליד צריך שם, טלפון או אימייל.'
                : 'שמות, טלפונים, אימיילים, סכומים וסטטוסים מזוהים אוטומטית.'}
            </p>
          )}
          {text ? (
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              ניקוי
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onChange(EXAMPLE_PASTE)}>
              דוגמה
            </Button>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Dialog.Close asChild>
          <Button variant="ghost" className="max-sm:hidden">
            ביטול
          </Button>
        </Dialog.Close>
        <Button variant="primary" className="max-sm:flex-1" disabled={count === 0} onClick={onContinue}>
          {count === 1 ? 'בדיקת הליד' : count > 0 ? `בדיקת ${count} הלידים` : 'בדיקת הלידים'}
        </Button>
      </DialogFooter>
    </div>
  );
}
