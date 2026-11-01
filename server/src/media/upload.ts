import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import multer from 'multer';
import { HttpError } from '../lib/http-error.js';

type MediaKind = 'audio' | 'video';

/** Recording formats phones, call recorders and Zoom produce, with the type to serve each as when the browser doesn't say. */
const FORMATS: Record<string, { kind: MediaKind; mimeType: string }> = {
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
  '.oga': { kind: 'audio', mimeType: 'audio/ogg' },
  '.opus': { kind: 'audio', mimeType: 'audio/ogg' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac' },
  '.amr': { kind: 'audio', mimeType: 'audio/amr' },
  '.3gp': { kind: 'audio', mimeType: 'audio/3gpp' },
  '.webm': { kind: 'video', mimeType: 'video/webm' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.m4v': { kind: 'video', mimeType: 'video/mp4' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime' },
};

export const ACCEPTED_EXTENSIONS = Object.keys(FORMATS);

/**
 * Whether a file is a recording, and the type to serve it as. The extension must be a known recording
 * format and the browser's type, when it sends a real one, must be audio or video.
 */
export function mediaTypeOf(declaredType: string, fileName: string): { kind: MediaKind; mimeType: string } | null {
  const format = FORMATS[extname(fileName).toLowerCase()];
  if (!format) return null;
  const mimeType = declaredType.split(';')[0].trim().toLowerCase();
  // Some systems don't know .amr or .opus and send a generic type.
  if (mimeType === '' || mimeType === 'application/octet-stream') return format;
  const match = /^(audio|video)\/[a-z0-9][a-z0-9.+-]{0,60}$/.exec(mimeType);
  if (!match) return null;
  const kind = match[1] as MediaKind;
  // A video container holding only audio (an .m4a sent as video/mp4) plays as audio.
  return { kind: kind === 'video' && format.kind === 'audio' ? 'audio' : kind, mimeType };
}

/**
 * Multer writes each upload to a temp file first, so a large Zoom recording never sits in memory.
 * One audio or video file per request, up to `maxBytes`.
 */
export function createUploader(maxBytes: number) {
  const directory = join(tmpdir(), 'omek-leads-uploads');
  mkdirSync(directory, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: directory,
      filename: (_req, file, done) => done(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    // Browsers send file names as UTF-8 (a Hebrew name would come out garbled as latin1).
    defParamCharset: 'utf8',
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1024 },
    fileFilter: (_req, file, done) => {
      if (mediaTypeOf(file.mimetype, file.originalname)) done(null, true);
      else done(new HttpError(415, 'אפשר להעלות רק הקלטת אודיו או וידאו (mp3, m4a, wav, ogg, mp4, mov או webm).'));
    },
  });
}

/** Multer's own errors, as messages for the person uploading */
export function uploadErrorMessage(error: unknown, maxMb: number): HttpError | null {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return new HttpError(413, `הקובץ גדול מ-${maxMb} MB.`);
    return new HttpError(400, 'שלחו הקלטה אחת, בשדה בשם "file".');
  }
  return null;
}

/** A file name that is safe to show and to put in a header: no folders, no control characters, at most 180 characters. */
export function cleanFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 180) return cleaned;
  const extension = extname(cleaned).slice(0, 10);
  return cleaned.slice(0, 180 - extension.length) + extension;
}
