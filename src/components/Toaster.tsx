import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useEffect } from 'react';
import { SPRING } from '../lib/motion';
import { useToasts, type Toast } from '../store/toasts';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div aria-live="polite" className="toaster pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <ToastCard key={item.id} toast={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  const Icon = toast.tone === 'success' ? CircleCheck : toast.tone === 'error' ? CircleAlert : null;
  const iconColor = toast.tone === 'success' ? 'var(--st-won)' : 'var(--danger)';

  return (
    <motion.div
      layout
      role={toast.tone === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
      transition={SPRING}
      className="glass-strong pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-2xl py-2.5 ps-4 pe-2"
    >
      {Icon && <Icon className="size-[18px] shrink-0" style={{ color: iconColor }} aria-hidden />}
      <div className="min-w-0 flex-1 py-0.5">
        <p dir="auto" className="line-clamp-2 text-[14px] font-medium">
          {toast.message}
        </p>
        {toast.description && (
          <p dir="auto" className="text-[13px] text-fg-muted">
            {toast.description}
          </p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="h-9 shrink-0 rounded-[10px] px-3 text-[13.5px] font-semibold text-focus hover:bg-field"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="סגירה"
        onClick={() => dismiss(toast.id)}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-faint hover:bg-field hover:text-fg"
      >
        <X className="size-4" aria-hidden />
      </button>
    </motion.div>
  );
}
