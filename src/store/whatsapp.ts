import { create } from 'zustand';
import { repository } from '../data/repository';
import type { WhatsAppStatus } from '../types';
import { useTimeline } from './timeline';
import { toast } from './toasts';

interface WhatsAppState {
  status: WhatsAppStatus | null;
  /** The WhatsApp panel (link, guard, sync) */
  open: boolean;
  busy: 'link' | 'reconnect' | 'unlink' | null;
  refresh: () => Promise<void>;
  setOpen: (open: boolean) => void;
  /** Starts linking: a QR code, or a code to type on the phone */
  link: (phone?: string) => Promise<void>;
  reconnect: () => Promise<void>;
  unlink: () => Promise<void>;
  /** Asks the phone for this lead's older messages, then checks the timeline for them */
  fetchHistory: (leadId: string) => Promise<void>;
  fetchVoiceNote: (leadId: string, messageId: string) => Promise<void>;
  reset: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');

/** Polls faster while something is changing: a QR code that renews, a connection coming up */
const busyLink = (status: WhatsAppStatus | null) =>
  status?.enabled === true && ['linking', 'connecting', 'reconnecting'].includes(status.link.state);

let timer: ReturnType<typeof setTimeout> | undefined;

/** Reloads a lead's timeline a few times while your phone answers (it can take a few seconds) */
function watchTimeline(leadId: string) {
  for (const delay of [3_000, 8_000, 15_000, 30_000]) {
    setTimeout(() => {
      if (useTimeline.getState().profiles[leadId]) void useTimeline.getState().load(leadId, true);
    }, delay);
  }
}

export const useWhatsApp = create<WhatsAppState>()((set, get) => {
  const schedule = () => {
    clearTimeout(timer);
    const { open, status } = get();
    if (status?.enabled === false) return;
    timer = setTimeout(() => void get().refresh(), busyLink(status) ? 2_000 : open ? 8_000 : 60_000);
  };

  return {
    status: null,
    open: false,
    busy: null,

    async refresh() {
      try {
        set({ status: await repository.whatsappStatus() });
      } catch {
        // Offline for a moment: the next poll tries again.
      }
      schedule();
    },

    setOpen(open) {
      set({ open });
      if (open) void get().refresh();
      else schedule();
    },

    async link(phone) {
      set({ busy: 'link' });
      try {
        set({ status: await repository.linkWhatsApp(phone) });
      } catch (error) {
        toast.error('לא הצלחנו להתחיל את הקישור.', messageOf(error));
      } finally {
        set({ busy: null });
        schedule();
      }
    },

    async reconnect() {
      set({ busy: 'reconnect' });
      try {
        set({ status: await repository.reconnectWhatsApp() });
      } catch (error) {
        toast.error('לא הצלחנו להתחבר מחדש.', messageOf(error));
      } finally {
        set({ busy: null });
        schedule();
      }
    },

    async unlink() {
      set({ busy: 'unlink' });
      try {
        const result = await repository.unlinkWhatsApp();
        set({ status: result });
        toast.show({
          message: 'הקישור לוואטסאפ נותק',
          description: result.removedFromPhone
            ? 'השרת הוסר מהמכשירים המקושרים שלך. השיחות ששוקפו נשארות בציר הזמן.'
            : 'כדאי להסיר אותו גם תחת "מכשירים מקושרים" בטלפון. השיחות ששוקפו נשארות בציר הזמן.',
        });
      } catch (error) {
        toast.error('לא הצלחנו לנתק את הקישור.', messageOf(error));
      } finally {
        set({ busy: null });
        schedule();
      }
    },

    async fetchHistory(leadId) {
      try {
        const result = await repository.fetchWhatsAppHistory(leadId);
        if (result.requested) {
          toast.show({ message: 'ביקשנו מהטלפון את השיחה', description: result.message });
          watchTimeline(leadId);
        } else {
          toast.show({ message: 'אין מה להביא', description: result.message });
        }
      } catch (error) {
        toast.error('לא הצלחנו לבקש את ההיסטוריה.', messageOf(error));
      }
    },

    async fetchVoiceNote(leadId, messageId) {
      try {
        await repository.fetchVoiceNote(leadId, messageId);
        watchTimeline(leadId);
      } catch (error) {
        toast.error('לא הצלחנו להביא את ההודעה הקולית.', messageOf(error));
      }
    },

    reset() {
      clearTimeout(timer);
      set({ status: null, open: false, busy: null });
    },
  };
});
