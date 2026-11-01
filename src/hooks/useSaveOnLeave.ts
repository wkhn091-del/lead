import { useEffect, useRef, type RefObject } from 'react';
import { drafts } from '../lib/drafts';

/**
 * For fields that save when you leave them (blur): leaving the page counts too. A phone call or switching apps
 * hides the page without moving focus, and a phone may close a page in the background; blurring the field as the
 * page hides saves what's in it right away.
 */
export function useSaveOnLeave(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const leave = () => {
      const element = ref.current;
      if (document.visibilityState === 'hidden' && element && document.activeElement === element) element.blur();
    };
    document.addEventListener('visibilitychange', leave);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', leave);
      window.removeEventListener('pagehide', leave);
    };
  }, [ref]);
}

/**
 * The draft of a field that saves on blur, kept on this device while it's typed (key "field:<id>"). If the page
 * closed before the field was left, what was typed comes back when the field shows again, and is saved then.
 * Returns how to keep each change as it's typed, and how to forget the draft once it's saved or undone.
 */
export function useFieldDraft<T>(id: string | undefined, saved: T, restore: (kept: T) => void) {
  const key = id ? `field:${id}` : null;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    if (!key) return;
    const kept = drafts.read<T>(key);
    drafts.clear(key);
    if (kept !== null && kept !== savedRef.current) restoreRef.current(kept);
  }, [key]);

  return {
    keep: (value: T) => {
      if (!key) return;
      if (value === savedRef.current) drafts.clear(key);
      else drafts.write(key, value);
    },
    forget: () => {
      if (key) drafts.clear(key);
    },
  };
}
