import { fillTemplate, templateFor } from '../../lib/messages';
import { whatsAppHref } from '../../lib/phone';
import { isOpen } from '../../lib/workflow';
import { useLeadStore } from '../../store/leads';
import { useMessages } from '../../store/messages';
import { useTimeline } from '../../store/timeline';
import { toast } from '../../store/toasts';
import type { Lead } from '../../types';

/** The ready-made message for where the lead stands, from your templates, with the lead's details in it */
export function messageFor(lead: Lead, templates = useMessages.getState().templates): string {
  const id = templateFor(lead);
  return fillTemplate(templates.find((template) => template.id === id)?.text ?? '', lead);
}

/** The lead's WhatsApp link with its ready-made message, kept up to date with your templates. Null without a number. */
export function useWhatsAppLink(lead: Lead): { href: string; message: string } | null {
  const templates = useMessages((s) => s.templates);
  const message = messageFor(lead, templates);
  const href = whatsAppHref(lead.phone, message);
  return href ? { href, message } : null;
}

/**
 * "שלח וואטסאפ": call it from the click on the wa.me link, which opens the chat with the message ready (a plain
 * link, so the browser lets it open at once; you send it from WhatsApp yourself). The lead moves to "נשלח
 * וואטסאפ", with the message on its timeline and Undo in the toast. A closed deal stays where it is: its timeline
 * just gets the message.
 */
export function logWhatsApp(lead: Lead, message = '') {
  const body = message.trim();
  if (isOpen(lead)) {
    const store = useLeadStore.getState();
    const result = store.act(lead.id, 'whatsapp', { body });
    if (!result) return;
    toast.show({
      message: `נפתח וואטסאפ עם ${lead.name}`,
      description: 'ההודעה מחכה לך בוואטסאפ, ונרשמה בציר הזמן. הליד עבר ל״נשלח וואטסאפ״; אם בסוף לא שלחת, אפשר לבטל.',
      duration: 8000,
      action: { label: 'ביטול', onClick: () => useLeadStore.getState().undo(lead.id, result.id) },
    });
    return;
  }
  if (useTimeline.getState().addMessage(lead, 'whatsapp', body || 'נשלחה הודעת וואטסאפ')) {
    toast.show({ message: `נפתח וואטסאפ עם ${lead.name}`, description: 'ההודעה נרשמה בציר הזמן.' });
  }
}
