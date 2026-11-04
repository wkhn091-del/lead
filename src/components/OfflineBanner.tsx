import { AnimatePresence, motion } from 'motion/react';
import { CloudOff, LoaderCircle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatRelative } from '../lib/format';
import { EASE_OUT } from '../lib/motion';
import { useLeadStore } from '../store/leads';
import { useOffline } from '../store/offline';
import { useSync } from '../store/sync';
import { Button } from './ui/Button';

/**
 * Says when the app isn't showing fresh data from the server: the phone has no signal, or the server is still
 * waking up, and the copy kept on this device shows meanwhile; or, on a device with no copy yet, that the leads
 * will show once the server answers. Everything stays usable; the line goes away by itself once it does.
 */
export function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  const keptAt = useOffline((s) => s.keptAt);
  const offline = useSync((s) => s.offline);
  // Nothing to show at all: the server didn't answer, and this device has no copy of the leads yet
  const nothing = useLeadStore((s) => s.loadState === 'error' && s.leads.length === 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!keptAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [keptAt]);
  // The copy is on the screen from the first frame: a server that answers within a moment needs no word
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!keptAt) return;
    const timer = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(timer);
  }, [keptAt]);

  const updated = keptAt ? ` (עודכן ${formatRelative(new Date(keptAt).toISOString(), now)})` : '';

  return (
    <AnimatePresence initial={false}>
      {((keptAt !== null && (offline || waited)) || nothing) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-field px-4 py-2.5 text-[13px] text-pretty text-fg-muted ring-1 ring-line ring-inset"
          >
            <p className="flex min-w-0 flex-1 basis-60 items-start gap-2.5">
              {offline || nothing ? (
                <CloudOff className="mt-0.5 size-4 shrink-0 text-[var(--st-no-answer)]" aria-hidden />
              ) : (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
              )}
              {nothing ? (
                <span>
                  <span className="font-medium text-fg">{offline ? 'אין חיבור לשרת.' : 'השרת לא החזיר את הלידים.'}</span> הם יופיעו כאן כשהוא יענה, ובינתיים
                  ננסה שוב כל חצי דקה.
                </span>
              ) : (
                <span>
                  <span className="font-medium text-fg">{offline ? 'אין חיבור לשרת.' : 'מתחבר לשרת…'}</span> מוצג המידע ששמור במכשיר הזה{updated}.
                  מה שתכתבו נשמר, ויישלח כשהשרת יענה.
                </span>
              )}
            </p>
            {nothing && (
              <Button size="sm" onClick={onRetry} className="max-sm:w-full">
                <RotateCcw className="size-4" aria-hidden />
                לנסות שוב
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
