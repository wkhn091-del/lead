import { AnimatePresence, motion } from 'motion/react';
import { ClipboardPaste, Moon, Plus, Search, Sun } from 'lucide-react';
import { appConfig } from '../config';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useUi } from '../store/ui';
import { BrandMark } from './BrandMark';
import { MOD } from './palette/CommandPalette';
import { SyncStatus } from './SyncStatus';
import { ViewTabs } from './ViewTabs';
import { Button, Kbd } from './ui/Button';

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
        <ThemeToggle />
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
 * once the tabs sit in it.
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
