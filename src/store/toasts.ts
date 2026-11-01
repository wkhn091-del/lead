import { create } from 'zustand';
import { createId } from '../lib/id';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  description?: string;
  tone: ToastTone;
  /** Milliseconds before it closes on its own */
  duration: number;
  action?: { label: string; onClick: () => void };
}

type ToastInput = Omit<Toast, 'id' | 'tone' | 'duration'> & Partial<Pick<Toast, 'tone' | 'duration'>>;

interface ToastState {
  toasts: Toast[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const MAX_VISIBLE = 3;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (input) => {
    const toast: Toast = { tone: 'neutral', duration: 4000, ...input, id: createId() };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE) }));
    return toast.id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  show: (input: ToastInput) => useToasts.getState().push(input),
  success: (message: string, description?: string) =>
    useToasts.getState().push({ message, description, tone: 'success' }),
  error: (message: string, description?: string) =>
    useToasts.getState().push({ message, description, tone: 'error', duration: 7000 }),
};
