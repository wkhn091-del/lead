import { useEffect } from 'react';
import { useUi } from '../store/ui';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Ctrl+K (⌘K) opens the command palette from anywhere, on the open lead if there is one.
 * N adds a lead, I imports a list, / focuses search, Esc closes the open lead.
 * Matches physical keys (event.code), so the shortcuts also work on a Hebrew keyboard layout.
 */
export function useHotkeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === 'KeyK') {
        event.preventDefault();
        const ui = useUi.getState();
        if (ui.paletteOpen) ui.closePalette();
        else ui.openPalette(ui.detailsId);
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const ui = useUi.getState();
      if (ui.addOpen || ui.importOpen || ui.paletteOpen) return;

      if (event.code === 'KeyN') {
        event.preventDefault();
        ui.setAddOpen(true);
      } else if (event.code === 'KeyI') {
        event.preventDefault();
        ui.setImportOpen(true);
      } else if (event.code === 'Slash') {
        event.preventDefault();
        document.getElementById('lead-search')?.focus();
      } else if (event.key === 'Escape' && ui.expandedId) {
        ui.setExpanded(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
