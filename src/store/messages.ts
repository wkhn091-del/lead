import { create } from 'zustand';
import { DEFAULT_TEMPLATES, type MessageTemplate, type TemplateId } from '../lib/messages';
import { safeStorage } from '../lib/storage';

/** The WhatsApp message templates, with your edits, kept on this device. A template you never edited follows the default. */
const KEY = 'omek-crm:whatsapp-templates:v1';

function readEdits(): Partial<Record<TemplateId, string>> {
  try {
    const stored = JSON.parse(safeStorage.get(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(stored).filter(([id, text]) => typeof text === 'string' && DEFAULT_TEMPLATES.some((item) => item.id === id)));
  } catch {
    return {};
  }
}

const withEdits = (edits: Partial<Record<TemplateId, string>>): MessageTemplate[] =>
  DEFAULT_TEMPLATES.map((template) => ({ ...template, text: edits[template.id] ?? template.text }));

interface MessagesState {
  templates: MessageTemplate[];
  /** Whether a template was changed from its default */
  edited: (id: TemplateId) => boolean;
  save: (id: TemplateId, text: string) => void;
  reset: (id: TemplateId) => void;
}

export const useMessages = create<MessagesState>()((set) => {
  let edits = readEdits();
  const keep = (next: Partial<Record<TemplateId, string>>) => {
    edits = next;
    safeStorage.set(KEY, JSON.stringify(edits));
    set({ templates: withEdits(edits) });
  };
  return {
    templates: withEdits(edits),
    edited: (id) => edits[id] !== undefined,
    save: (id, text) => {
      const fallback = DEFAULT_TEMPLATES.find((item) => item.id === id)?.text;
      const { [id]: _old, ...rest } = edits;
      keep(text.trim() && text.trim() !== fallback ? { ...rest, [id]: text.trim() } : rest);
    },
    reset: (id) => {
      const { [id]: _old, ...rest } = edits;
      keep(rest);
    },
  };
});

/** A template's text, as you last saved it */
export const templateText = (id: TemplateId) => useMessages.getState().templates.find((item) => item.id === id)?.text ?? '';
