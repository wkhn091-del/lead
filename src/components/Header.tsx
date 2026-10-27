import { AnimatePresence, motion } from 'motion/react';
import { ClipboardPaste, LogOut, MessageCircle, Moon, Plus, Search, Sun } from 'lucide-react';
import { useState } from 'react';
import { appConfig } from '../config';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { cn } from '../lib/cn';
import { count, NOUNS } from '../lib/hebrew';
import { useAuth } from '../store/auth';
import { useLeadStore } from '../store/leads';
import { useSync } from '../store/sync';
import { useUi } from '../store/ui';
import { useWhatsApp } from '../store/whatsapp';
import { BrandMark } from './BrandMark';
import { MOD } from './palette/CommandPalette';
import { SyncStatus } from './SyncStatus';
import { ViewTabs } from './ViewTabs';
import { Button, Kbd } from './ui/Button';
import { DialogBody, DialogFooter, DialogHeading, ResponsiveDialog } from './ui/ResponsiveDialog';

export function Header() {
  const setAddOpen = useUi((s) => s.setAddOpen);
  const setImportOpen = useUi((s) => s.setImportOpen);

  return (
    <header className="flex items-center justify-between gap-3 py-5 sm:py-7">
      <div className="flex min-w-0 items-center gap-3 lg:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark className="size-9 shrink-0" />
          {/* Between 1024 and 1280 the tabs need the room, and the mark stands for the name */}
          <p className="truncate text-[17px] font-semibold tracking-[-0.01em] lg:max-xl:sr-only">
            {appConfig.brand.name} <span className="font-normal text-fg-muted">{appConfig.brand.product}</span>
          </p>
        </div>
        <ViewTabs fit className="shrink-0 max-lg:hidden" />
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <SyncStatus />
        <PaletteButton />
        <WhatsAppButton />
        <ThemeToggle />
        <SignOutButton />
        {/* Next to the tabs (from 1024 up) the header is full, so the import button is an icon there too */}
        <Button variant="ghost" size="icon" className="sm:max-lg:hidden" aria-label="ייבוא לידים" title="ייבוא לידים (I)" onClick={() => setImportOpen(true)}>
          <ClipboardPaste className="size-[18px]" aria-hidden />
        </Button>
        <Button className="max-sm:hidden lg:hidden" onClick={() => setImportOpen(true)}>
          <ClipboardPaste className="size-4" aria-hidden />
          ייבוא
        </Button>
        <Button variant="primary" className="max-sm:hidden" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" strokeWidth={2.5} aria-hidden />
          ליד חדש
          <Kbd className="ms-1">N</Kbd>
        </Button>
      </div>
    </header>
  );
}

const paletteKeys = () => (MOD === '⌘' ? '⌘K' : 'Ctrl K');

/**
 * Opens the Ctrl+K command palette. The shortcut is in its tooltip and in the footer's hints: the header is full
 * once the tabs sit in it, more so with the server's buttons (WhatsApp, sign out).
 */
function PaletteButton() {
  const openPalette = useUi((s) => s.openPalette);
  const label = `חיפוש ופקודות (${MOD}+K)`;
  return (
    <>
      <Button variant="ghost" size="icon" className="max-sm:hidden xl:hidden" aria-label={label} title={label} onClick={() => openPalette()}>
        <Search className="size-[18px]" aria-hidden />
      </Button>
      <button
        type="button"
        onClick={() => openPalette()}
        title={`חיפוש ליד או תיעוד שיחה (${paletteKeys()})`}
        aria-keyshortcuts={MOD === '⌘' ? 'Meta+K' : 'Control+K'}
        className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-field ps-3 pe-4 text-[13.5px] whitespace-nowrap text-fg-faint ring-1 ring-line ring-inset transition-colors hover:bg-field-hover hover:text-fg-muted max-xl:hidden"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-start">חיפוש</span>
      </button>
    </>
  );
}

/** The WhatsApp sync's state at a glance; opens its panel */
function WhatsAppButton() {
  const status = useWhatsApp((s) => s.status);
  const setOpen = useWhatsApp((s) => s.setOpen);
  if (!status) return null;
  const state = status.enabled ? status.link.state : 'off';
  const dot =
    state === 'connected'
      ? 'bg-[var(--whatsapp)]'
      : state === 'stopped'
        ? 'bg-[var(--st-lost)]'
        : state === 'linking' || state === 'connecting' || state === 'reconnecting'
          ? 'bg-[var(--st-no-answer)] animate-pulse'
          : null;
  const label = {
    connected: 'וואטסאפ: מסונכרן, קריאה בלבד',
    stopped: 'וואטסאפ: הסנכרון נעצר',
    linking: 'וואטסאפ: מחכה לטלפון שלך',
    connecting: 'וואטסאפ: מתחבר',
    reconnecting: 'וואטסאפ: מתחבר מחדש',
    unlinked: 'וואטסאפ: לא מקושר',
    off: 'סנכרון הוואטסאפ כבוי',
  }[state];
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={() => setOpen(true)} className="relative">
      <MessageCircle className="size-[18px]" style={state === 'connected' ? { color: 'var(--whatsapp)' } : undefined} aria-hidden />
      {dot && <span className={cn('absolute top-2 end-2 size-2 rounded-full ring-2 ring-[var(--canvas)]', dot)} />}
    </Button>
  );
}

/** Only shown when leads live on the server. Pending deletes are sent before signing out. */
function SignOutButton() {
  const required = useAuth((s) => s.required);
  const email = useAuth((s) => s.email);
  const [confirming, setConfirming] = useState(false);
  if (!required) return null;

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="יציאה מהחשבון" title={email ? `יציאה מהחשבון (${email})` : 'יציאה מהחשבון'} onClick={() => setConfirming(true)}>
        <LogOut className="flip-rtl size-[18px]" aria-hidden />
      </Button>
      <SignOutDialog open={confirming} onOpenChange={setConfirming} />
    </>
  );
}

/**
 * Signing out is never needed (the app stays signed in, like any app on a phone), so it asks first, and says what
 * it does: the leads stay on the server, and only this device's copy goes.
 */
function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const signOut = useAuth((s) => s.signOut);
  const flushPendingRemovals = useLeadStore((s) => s.flushPendingRemovals);
  const waiting = useSync((s) => s.items.length);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="sm:w-[480px]">
      <DialogHeading
        title="לצאת מהחשבון?"
        description="אין צורך לצאת: האפליקציה נשארת מחוברת, והלידים זמינים בה תמיד, גם בלי אינטרנט."
      />
      <DialogBody className="space-y-3 text-[14px] text-pretty text-fg-muted">
        <p>
          יציאה מוחקת מהמכשיר הזה את העותק השמור של הלידים, ואחריה צריך להיכנס שוב עם הסיסמה. <span className="font-medium text-fg">בשרת לא נמחק כלום</span>: אחרי
          הכניסה הכול חוזר.
        </p>
        <p>כדאי לצאת רק ממכשיר שאינו שלך, או לפני שמוסרים את הטלפון למישהו אחר.</p>
        {waiting > 0 && (
          <p className="rounded-xl bg-[color-mix(in_oklab,var(--st-no-answer)_12%,transparent)] px-3.5 py-2.5 text-fg">
            {waiting === 1 ? 'שינוי אחד עוד לא נשלח לשרת.' : `${count(waiting, NOUNS.change)} עוד לא נשלחו לשרת.`} הם יישארו במכשיר הזה, ויישלחו בכניסה הבאה.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={() => onOpenChange(false)} className="max-sm:flex-1">
          להישאר מחובר
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onOpenChange(false);
            flushPendingRemovals();
            void signOut();
          }}
          className="max-sm:flex-1"
        >
          יציאה
        </Button>
      </DialogFooter>
    </ResponsiveDialog>
  );
}

function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = theme === 'system' ? systemDark : theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'מעבר לתצוגה בהירה' : 'מעבר לתצוגה כהה'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? 'moon' : 'sun'}
          initial={{ opacity: 0, rotate: -50, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 50, scale: 0.7 }}
          transition={{ duration: 0.18 }}
          className="flex"
        >
          {dark ? <Moon className="size-[18px]" aria-hidden /> : <Sun className="size-[18px]" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
