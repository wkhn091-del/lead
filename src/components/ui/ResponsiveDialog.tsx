import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/cn';
import { EASE_OUT } from '../../lib/motion';
import { Button } from './Button';

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Desktop width, for example "sm:w-[540px]" */
  className?: string;
  /** Id of the field to focus when the dialog opens */
  initialFocus?: string;
  /** Keeps the dialog open, for example while an import is saving */
  locked?: boolean;
  children: ReactNode;
}

/** A centered dialog on desktop and a bottom sheet you can swipe down on phones. */
export function ResponsiveDialog({ open, onOpenChange, className, initialFocus, locked = false, children }: ResponsiveDialogProps) {
  const desktop = useMediaQuery('(min-width: 640px)');
  const dragControls = useDragControls();
  const requestChange = (next: boolean) => {
    if (next || !locked) onOpenChange(next);
  };
  const blockWhileLocked = (event: Event) => {
    if (locked) event.preventDefault();
  };

  return (
    <Dialog.Root open={open} onOpenChange={requestChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              onOpenAutoFocus={(event) => {
                if (!initialFocus) return;
                event.preventDefault();
                document.getElementById(initialFocus)?.focus();
              }}
              onEscapeKeyDown={blockWhileLocked}
              onInteractOutside={blockWhileLocked}
            >
              <motion.div
                className={cn(
                  'glass-strong fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[26px] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:-translate-x-1/2 sm:rounded-[24px]',
                  className,
                )}
                initial={desktop ? { opacity: 0, y: 12, scale: 0.97 } : { y: '100%' }}
                animate={desktop ? { opacity: 1, y: 0, scale: 1 } : { y: 0 }}
                exit={desktop ? { opacity: 0, y: 8, scale: 0.98 } : { y: '100%' }}
                transition={desktop ? { duration: 0.22, ease: EASE_OUT } : { type: 'spring', stiffness: 420, damping: 40 }}
                drag={desktop || locked ? false : 'y'}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 110 || info.velocity.y > 600) requestChange(false);
                }}
              >
                {!desktop && (
                  <div
                    className="flex shrink-0 touch-none justify-center pt-2.5 pb-1"
                    onPointerDown={(event) => {
                      if (!locked) dragControls.start(event);
                    }}
                  >
                    <span className="h-1.5 w-10 rounded-full bg-line-strong" />
                  </div>
                )}
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface DialogHeadingProps {
  title: string;
  description: ReactNode;
  /** Hides the close button, for example while saving */
  closable?: boolean;
}

export function DialogHeading({ title, description, closable = true }: DialogHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-3 sm:px-7 sm:pt-6">
      <div className="min-w-0">
        <Dialog.Title className="text-[20px] font-semibold tracking-[-0.015em]">{title}</Dialog.Title>
        <Dialog.Description className="mt-1 text-[13.5px] text-pretty text-fg-muted">{description}</Dialog.Description>
      </div>
      {closable && (
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label="סגירה" className="-mt-1 -me-2">
            <X className="size-5" aria-hidden />
          </Button>
        </Dialog.Close>
      )}
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7', className)}>{children}</div>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 border-t border-line px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:justify-end sm:px-7 sm:pb-5',
        className,
      )}
    >
      {children}
    </div>
  );
}
