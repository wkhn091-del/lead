import type { CSSProperties } from 'react';
import {
  Archive,
  FileText,
  Handshake,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Sparkle,
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

/**
 * The three stages the server keeps (server/src/leads/workflow.ts): outreach (calls and WhatsApp until the prospect
 * wants a price), the quote, and the closed deal. `next` names the step to the next stage.
 */
export const STAGE_META: Record<Stage, ToneMeta & { step: number; next: string | null }> = {
  cold_call: { label: 'פנייה', step: 1, next: 'הצעת מחיר', icon: PhoneOutgoing, tone: 'var(--st-cold)' },
  zoom: { label: 'הצעת מחיר', step: 2, next: 'נסגר / לקוח', icon: FileText, tone: 'var(--st-zoom)' },
  closed: { label: 'נסגר / לקוח', step: 3, next: null, icon: Handshake, tone: 'var(--st-won)' },
};

export const ARCHIVED_META: ToneMeta = { label: 'לא רלוונטי', icon: Archive, tone: 'var(--st-lost)' };

/** How a logged step reads in the daily queue */
export const OUTCOME_META: Record<ActivityType, ToneMeta> = {
  advanced: { label: 'התקדם', icon: STAGE_META.zoom.icon, tone: 'var(--st-zoom)' },
  answered: { label: 'ענה', icon: PhoneIncoming, tone: 'var(--st-answered)' },
  no_answer: { label: 'אין מענה', icon: PhoneMissed, tone: 'var(--st-no-answer)' },
  archived: ARCHIVED_META,
  whatsapp: { label: 'נשלח וואטסאפ', icon: MessageCircle, tone: 'var(--whatsapp)' },
};

/**
 * The board's columns, in order. Derived from the stage and the latest contact, so nothing new is stored: a lead
 * at the outreach stage is new until a call or a WhatsApp message is logged, and then sits where the latest one
 * puts it.
 */
export const PIPELINE = ['new', 'contacted', 'whatsapp', 'quote', 'client'] as const;
export type PipelineStatus = (typeof PIPELINE)[number];

export const STATUS_META: Record<PipelineStatus, ToneMeta & { short: string }> = {
  new: { label: 'חדש', short: 'חדש', icon: Sparkle, tone: 'var(--st-cold)' },
  contacted: { label: 'נוצר קשר (שיחה)', short: 'נוצר קשר', icon: PhoneCall, tone: 'var(--st-answered)' },
  whatsapp: { label: 'נשלח וואטסאפ', short: 'וואטסאפ', icon: MessageCircle, tone: 'var(--whatsapp)' },
  quote: { label: 'הצעת מחיר', short: 'הצעת מחיר', icon: STAGE_META.zoom.icon, tone: STAGE_META.zoom.tone },
  client: { label: 'נסגר / לקוח', short: 'לקוח', icon: STAGE_META.closed.icon, tone: STAGE_META.closed.tone },
};

/** The lead's column on the board. Leads marked not relevant keep theirs, and are shown apart. */
export function pipelineStatus(lead: Pick<Lead, 'stage' | 'activity'>): PipelineStatus {
  if (lead.stage === 'closed') return 'client';
  if (lead.stage === 'zoom') return 'quote';
  const latest = lead.activity.find((step) => step.type === 'whatsapp' || step.type === 'answered' || step.type === 'no_answer');
  if (!latest) return 'new';
  return latest.type === 'whatsapp' ? 'whatsapp' : 'contacted';
}

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

/** The badge a lead shows: its status on the board, or "לא רלוונטי" once archived */
export const leadBadge = (lead: Pick<Lead, 'stage' | 'archivedAt' | 'activity'>): ToneMeta =>
  lead.archivedAt ? ARCHIVED_META : STATUS_META[pipelineStatus(lead)];

export const CHANNEL_META: Record<ContactMethod, ToneMeta> = {
  call: { label: 'שיחה', icon: Phone, tone: 'var(--fg-muted)' },
  // Lucide ships no brand logos, so WhatsApp is a chat bubble in WhatsApp green.
  whatsapp: { label: 'וואטסאפ', icon: MessageCircle, tone: 'var(--whatsapp)' },
};

export const CHANNEL_OPTIONS = CONTACT_METHODS.map((method) => ({ value: method, ...CHANNEL_META[method] }));

/** Sets the --tone custom property read by .tone-chip and .tone-text */
export const toneStyle = (tone: string): CSSProperties => ({ '--tone': tone });
