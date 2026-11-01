import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { SPRING } from '../lib/motion';
import { useUi } from '../store/ui';

/** Thumb-reach "ליד חדש" button for phones, for logging a lead mid-call. */
export function AddLeadFab() {
  const open = useUi((s) => s.addOpen);
  const setAddOpen = useUi((s) => s.setAddOpen);
  // The Prospector keeps the bottom edge for its import bar
  const prospector = useUi((s) => s.view === 'prospector');

  return (
    <AnimatePresence>
      {!open && !prospector && (
        <motion.button
          type="button"
          aria-label="ליד חדש"
          onClick={() => setAddOpen(true)}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          whileTap={{ scale: 0.92 }}
          transition={SPRING}
          className="fab fixed z-30 flex size-14 items-center justify-center rounded-[20px] bg-primary text-primary-fg sm:hidden"
        >
          <Plus className="size-6" strokeWidth={2.5} aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
