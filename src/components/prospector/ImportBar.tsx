import { AnimatePresence, motion } from 'motion/react';
import { Import, LoaderCircle, X } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { count, NOUNS } from '../../lib/hebrew';
import { SPRING } from '../../lib/motion';
import { canImport } from '../../lib/prospects';
import { useProspector } from '../../store/prospector';
import { Button, Kbd } from '../ui/Button';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Shows once businesses are picked: imports them as leads, into the Daily 10 pool. Ctrl+Enter (⌘↵) imports too. */
export function ImportBar() {
  const { current, selected, importing, importSelected, clearSelection } = useProspector(
    useShallow((s) => ({
      current: s.current,
      selected: s.selected,
      importing: s.importing,
      importSelected: s.importSelected,
      clearSelection: s.clearSelection,
    })),
  );
  const picked = current?.prospects.filter((item) => selected.has(item.id) && canImport(item)).length ?? 0;
  const shown = picked > 0;

  // Toasts move up while the bar is in the way
  useEffect(() => {
    document.body.classList.toggle('has-dock', shown);
    return () => document.body.classList.remove('has-dock');
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void importSelected();
      } else if (event.key === 'Escape' && !(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shown, importSelected, clearSelection]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          role="region"
          aria-label="ייבוא ל-CRM"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={SPRING}
          className="dock pointer-events-none fixed inset-x-0 z-40 flex justify-center"
        >
          <div className="glass-strong pointer-events-auto flex w-full max-w-[600px] items-center gap-3 rounded-2xl py-2.5 ps-4 pe-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{picked === 1 ? 'עסק אחד נבחר' : `${count(picked, NOUNS.business)} נבחרו`}</p>
              <p className="truncate text-[12.5px] text-fg-muted">ייכנסו למאגר העשירייה היומית, בשלב שיחה קרה</p>
            </div>
            <Button size="sm" variant="ghost" onClick={clearSelection} aria-label="ניקוי הבחירה" className="max-sm:px-2">
              <X className="size-4" aria-hidden />
              <span className="max-sm:hidden">ניקוי</span>
            </Button>
            <Button size="sm" variant="primary" disabled={importing} onClick={() => void importSelected()}>
              {importing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Import className="flip-rtl size-4" aria-hidden />}
              {importing ? 'מייבא…' : 'ייבוא ל-CRM'}
              <Kbd className="max-sm:hidden">{isMac ? '⌘↵' : 'Ctrl ↵'}</Kbd>
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
