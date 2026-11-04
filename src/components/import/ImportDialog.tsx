import * as Dialog from '@radix-ui/react-dialog';
import { Braces, Sparkles } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { drafts } from '../../lib/drafts';
import { EXAMPLE_PASTE } from '../../lib/import/example';
import { parseImport, type ImportFormat } from '../../lib/import/parse';
import { useUi } from '../../store/ui';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Button } from '../ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from '../ui/ResponsiveDialog';
import { Segmented, type SegmentedOption } from '../ui/Segmented';
import { inputBase } from '../ui/styles';
import { JsonImportStep } from './JsonImportStep';
import { ReviewStep } from './ReviewStep';

/**
 * Kept when the dialog closes, and on this device, so an accidental close or a reload doesn't lose the paste.
 * Cleared after an import. A table and a JSON paste are kept apart.
 */
const DRAFT_KEY = 'import-paste';
const JSON_DRAFT_KEY = 'import-json';
/** The kind of paste the dialog opens on: the last one used */
const MODE_KEY = 'import-mode';
/** Above this a paste isn't kept as a draft: a whole file would crowd out what the app keeps on this device */
const DRAFT_LIMIT = 500_000;
const keep = (key: string, text: string) => (text.trim() && text.length <= DRAFT_LIMIT ? drafts.write(key, text) : drafts.clear(key));

type Mode = 'table' | 'json';
const MODE_OPTIONS: readonly SegmentedOption<Mode>[] = [
  { value: 'table', label: 'טבלה או רשימה' },
  { value: 'json', label: 'JSON', icon: Braces },
];

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
        onClose={() => {
          setLocked(false);
          setOpen(false);
        }}
      />
    </ResponsiveDialog>
  );
}

interface ImportFlowProps {
  onLockChange: (locked: boolean) => void;
  onClose: () => void;
}

function ImportFlow({ onLockChange, onClose }: ImportFlowProps) {
  const [mode, setModeState] = useState<Mode>(() => (drafts.read<Mode>(MODE_KEY) === 'json' ? 'json' : 'table'));
  const [text, setText] = useState(() => drafts.read<string>(DRAFT_KEY) ?? '');
  const [json, setJson] = useState(() => drafts.read<string>(JSON_DRAFT_KEY) ?? '');
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  const setMode = (next: Mode) => {
    drafts.write(MODE_KEY, next);
    setModeState(next);
  };
  const changeText = (value: string) => {
    keep(DRAFT_KEY, value);
    setText(value);
  };
  const changeJson = (value: string) => {
    keep(JSON_DRAFT_KEY, value);
    setJson(value);
  };
  const close = (imported: boolean) => {
    if (imported) drafts.clear(mode === 'json' ? JSON_DRAFT_KEY : DRAFT_KEY);
    onClose();
  };
  const switcher = <Segmented label="מה מדביקים" value={mode} options={MODE_OPTIONS} onChange={setMode} className="shrink-0 sm:w-[340px]" />;

  if (mode === 'json') {
    return <JsonImportStep text={json} onChange={changeJson} switcher={switcher} onLockChange={onLockChange} onClose={close} />;
  }
  if (step === 'review') {
    return <ReviewStep text={text} onBack={() => setStep('paste')} onLockChange={onLockChange} onClose={close} />;
  }
  return (
    <PasteStep
      text={text}
      onChange={changeText}
      switcher={switcher}
      onContinue={() => setStep('review')}
      onJson={() => {
        // JSON pasted as a table: it moves to the JSON paste, as it is
        changeJson(text);
        changeText('');
        setMode('json');
      }}
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
  /** Switches between pasting a table and pasting JSON */
  switcher: ReactNode;
  onContinue: () => void;
  /** Moves what was pasted to the JSON paste */
  onJson: () => void;
}

function PasteStep({ text, onChange, switcher, onContinue, onJson }: PasteStepProps) {
  const deferred = useDeferredValue(text);
  const result = useMemo(() => parseImport(deferred), [deferred]);
  const count = result.rows.length;
  const looksLikeJson = /^\s*[[{]/.test(deferred);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeading
        title="ייבוא לידים"
        description="מדביקים שורות מאקסל או מ-Google Sheets, קובץ CSV, או רשימה עם ליד אחד בכל שורה."
      />
      <DialogBody className="flex flex-col gap-3">
        {switcher}
        {looksLikeJson && (
          <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-field px-3.5 py-2.5 text-[13.5px] text-pretty ring-1 ring-line ring-inset">
            <span>נראה שהדבקת JSON. בייבוא JSON כל שדה נקרא בשמו, ומספרים שכבר קיימים מדולגים.</span>
            <Button size="sm" variant="primary" onClick={onJson} className="max-sm:w-full">
              <Braces className="size-4" aria-hidden />
              לייבא כ-JSON
            </Button>
          </p>
        )}
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
