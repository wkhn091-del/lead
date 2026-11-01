import type { MediaFile } from '../types';

/** Recording formats the server accepts (server/src/media/upload.ts), with the kind each one usually is */
const FORMATS: Record<string, MediaFile['kind']> = {
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  flac: 'audio',
  amr: 'audio',
  '3gp': 'audio',
  webm: 'video',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
};

/** For the file picker */
export const RECORDING_ACCEPT = ['audio/*', 'video/*', ...Object.keys(FORMATS).map((ext) => `.${ext}`)].join(',');

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** Audio or video, judged like the server does: a known extension, and an audio or video type when the browser knows one. */
export function recordingKind(file: Pick<File, 'name' | 'type'>): MediaFile['kind'] | null {
  const byExtension = FORMATS[extensionOf(file.name)];
  if (!byExtension) return null;
  const type = file.type.toLowerCase();
  if (!type || type === 'application/octet-stream') return byExtension;
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return byExtension === 'audio' ? 'audio' : 'video';
  return null;
}

/** Why a file can't be uploaded, or null when it can */
export function recordingProblem(file: File, maxMb: number): string | null {
  if (!recordingKind(file)) return `${file.name} הוא לא הקלטת אודיו או וידאו. אפשר mp3, m4a, wav, ogg, mp4, mov או webm.`;
  if (file.size > maxMb * 1024 * 1024) return `${file.name} גדול מ-${maxMb} MB.`;
  return null;
}

/** "820 KB", "4.2 MB", "1.3 GB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** "4:07" or "1:02:45" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
