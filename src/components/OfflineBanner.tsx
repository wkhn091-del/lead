import { AnimatePresence, motion } from 'motion/react';
import { CloudOff, KeyRound, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatRelative } from '../lib/format';
import { EASE_OUT } from '../lib/motion';
import { useAuth } from '../store/auth';
import { useOffline } from '../store/offline';
import { useSync } from '../store/sync';
import { Button } from './ui/Button';

/**
 * Says when the app isn't showing fresh data from the server: the phone has no signal, the server is still waking
 * up (the copy kept on this device shows meanwhile), or the session ended and signing in again is needed to send
 * what's written. Everything stays usable in all three; the line goes away by itself once the server answers.
 */
export function OfflineBanner() {
  const keptAt = useOffline((s) => s.keptAt);
  const offline = useSync((s) => s.offline);
  const expired = useAuth((s) => s.expired);
  const setPrompt = useAuth((s) => s.setPrompt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!keptAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [keptAt]);

  const shown = expired || Boolean(keptAt);
  const updated = keptAt ? ` (עודכן ${formatRelative(new Date(keptAt).toISOString(), now)})` : '';

  return (
    <AnimatePresence initial={false}>
      {shown && (
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
              {expired ? (
                <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--st-no-answer)]" aria-hidden />
              ) : offline ? (
                <CloudOff className="mt-0.5 size-4 shrink-0 text-[var(--st-no-answer)]" aria-hidden />
              ) : (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
              )}
              {expired ? (
                <span>
                  <span className="font-medium text-fg">החיבור לחשבון הסתיים.</span> כל הלידים נשארים כאן, ומה שתכתבו נשמר. כדי לשלוח
                  אותו לשרת צריך להיכנס שוב.
                </span>
              ) : (
                <span>
                  <span className="font-medium text-fg">{offline ? 'אין חיבור לשרת.' : 'מתחבר לשרת…'}</span> מוצג המידע ששמור במכשיר הזה{updated}.
                  מה שתכתבו נשמר, ויישלח כשהשרת יענה.
                </span>
              )}
            </p>
            {expired && (
              <Button size="sm" variant="primary" onClick={() => setPrompt(true)} className="max-sm:w-full">
                כניסה
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
