import type { Interaction, MediaFile } from '../types';
import { STAGE_META } from './stages';

export interface TimelineItem {
  entry: Interaction;
  /** "ניסיון 2: ענה ← פגישת זום" */
  title: string;
  /** Recordings attached to this entry */
  media: MediaFile[];
}

/**
 * Names each entry the way the AI coach sees it (server/src/coach/prompt.ts): every logged phone call
 * is an attempt, numbered from the first. Input and output are newest first.
 */
export function describeTimeline(newestFirst: readonly Interaction[], media: readonly MediaFile[] = []): TimelineItem[] {
  const byEntry = new Map<string, MediaFile[]>();
  for (const file of media) {
    if (file.interactionId) byEntry.set(file.interactionId, [...(byEntry.get(file.interactionId) ?? []), file]);
  }

  let attempt = 0;
  const items = [...newestFirst].reverse().map((entry): TimelineItem => {
    // In Hebrew the arrow points left, the way the text runs
    const moved = entry.stageTo ? ` ← ${STAGE_META[entry.stageTo].label}` : '';
    let title: string;
    if (entry.step === 'archived') title = 'סומן כלא רלוונטי';
    else if (entry.kind === 'call') {
      attempt += 1;
      title = `ניסיון ${attempt}: ${entry.outcome === 'no_answer' ? 'אין מענה' : 'ענה'}${moved}`;
    } else if (entry.kind === 'zoom') title = entry.outcome === 'no_show' ? 'פגישת זום: הליד לא הגיע' : `פגישת זום התקיימה${moved}`;
    else if (entry.source === 'whatsapp') title = 'שיחת וואטסאפ';
    else title = { whatsapp: 'הודעת וואטסאפ', email: 'אימייל', note: 'הערה' }[entry.kind];
    return { entry, title, media: byEntry.get(entry.id) ?? [] };
  });
  return items.reverse();
}

/** Recordings attached to the lead rather than to one entry (or whose entry was deleted) */
export function looseMedia(media: readonly MediaFile[], entries: readonly Interaction[]): MediaFile[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return media.filter((file) => !file.interactionId || !ids.has(file.interactionId));
}

/** Starts each automatic transcript added to an entry's text (server/src/transcription/pipeline.ts) */
export const TRANSCRIPT_MARKER = '[Auto-Transcript]';

/** An entry's own notes, and the automatic transcripts added after them, for showing them apart */
export function splitTranscripts(body: string): { notes: string; transcripts: string[] } {
  const [notes, ...transcripts] = body.split(TRANSCRIPT_MARKER);
  return { notes: notes.trim(), transcripts: transcripts.map((text) => text.trim()).filter(Boolean) };
}

export const isTranscribing = (media: Pick<MediaFile, 'transcription'>) =>
  media.transcription?.status === 'queued' || media.transcription?.status === 'running';

/** "מכין את האודיו", "חלק 2 מתוך 5", "ממתין בתור" */
export function transcriptionProgress(media: Pick<MediaFile, 'transcription'>): string {
  const job = media.transcription;
  if (!job || job.status === 'queued') return 'ממתין בתור';
  if (job.partsTotal === 0) return 'מכין את האודיו';
  return job.partsTotal === 1 ? 'מקשיב להקלטה' : `חלק ${Math.min(job.partsDone + 1, job.partsTotal)} מתוך ${job.partsTotal}`;
}
