import type { CSSProperties } from 'react';
import {
  Archive,
  Handshake,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react';
import { CONTACT_METHODS, type ActivityType, type ContactMethod, type Interaction, type Lead, type Stage } from '../types';

export interface ToneMeta {
  label: string;
  icon: LucideIcon;
  /** CSS color, usually a token from index.css */
  tone: string;
}

export const STAGE_META: Record<Stage, ToneMeta & { step: number; next: string | null }> = {
  cold_call: { label: 'שיחה קרה', step: 1, next: 'נקבע זום', icon: PhoneOutgoing, tone: 'var(--st-cold)' },
  zoom: { label: 'פגישת זום', step: 2, next: 'סגירת עסקה', icon: Video, tone: 'var(--st-zoom)' },
  closed: { label: 'עסקה סגורה', step: 3, next: null, icon: Handshake, tone: 'var(--st-won)' },
};

export const ARCHIVED_META: ToneMeta = { label: 'לא רלוונטי', icon: Archive, tone: 'var(--st-lost)' };

/** How a logged step reads in the daily queue */
export const OUTCOME_META: Record<ActivityType, ToneMeta> = {
  advanced: { label: 'התקדם', icon: STAGE_META.zoom.icon, tone: 'var(--st-zoom)' },
  answered: { label: 'ענה', icon: PhoneIncoming, tone: 'var(--st-answered)' },
  no_answer: { label: 'אין מענה', icon: PhoneMissed, tone: 'var(--st-no-answer)' },
  archived: ARCHIVED_META,
};

/** The icon and color of a timeline entry: what happened, and where it led */
export function entryMeta(entry: Pick<Interaction, 'kind' | 'outcome' | 'step' | 'stageTo'>): Omit<ToneMeta, 'label'> {
  if (entry.step === 'archived') return ARCHIVED_META;
  if (entry.stageTo) return STAGE_META[entry.stageTo];
  switch (entry.kind) {
    case 'call':
      return entry.outcome === 'no_answer' ? OUTCOME_META.no_answer : OUTCOME_META.answered;
    case 'zoom':
      return entry.outcome === 'no_show'
        ? { icon: VideoOff, tone: 'var(--st-no-answer)' }
        : { icon: Video, tone: 'var(--st-zoom)' };
    case 'whatsapp':
      return { icon: MessageCircle, tone: 'var(--whatsapp)' };
    case 'email':
      return { icon: Mail, tone: 'var(--st-cold)' };
    case 'note':
      return { icon: NotebookPen, tone: 'var(--fg-muted)' };
  }
}

/** The badge a lead shows: its stage, or "לא רלוונטי" once archived */
export const leadBadge = (lead: Pick<Lead, 'stage' | 'archivedAt'>): ToneMeta =>
  lead.archivedAt ? ARCHIVED_META : STAGE_META[lead.stage];

export const CHANNEL_META: Record<ContactMethod, ToneMeta> = {
  call: { label: 'שיחה', icon: Phone, tone: 'var(--fg-muted)' },
  // Lucide ships no brand logos, so WhatsApp is a chat bubble in WhatsApp green.
  whatsapp: { label: 'וואטסאפ', icon: MessageCircle, tone: 'var(--whatsapp)' },
};

export const CHANNEL_OPTIONS = CONTACT_METHODS.map((method) => ({ value: method, ...CHANNEL_META[method] }));

/** Sets the --tone custom property read by .tone-chip and .tone-text */
export const toneStyle = (tone: string): CSSProperties => ({ '--tone': tone });
