import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptionError } from './errors.js';
import { planParts, prepareAudio, splitAudio } from './ffmpeg.js';
import { MAX_UPLOAD_BYTES, type Transcriber } from './openai.js';

/** Put in front of a transcript added to a timeline entry */
export const TRANSCRIPT_MARKER = '[Auto-Transcript]';

export interface RecordingOptions {
  ffmpeg: string;
  transcriber: Transcriber;
  /** Target length of each part sent for transcription */
  partSeconds: number;
  keywords?: string[];
  /** Called once the parts are known (0 of n), and after each part */
  onProgress?: (done: number, total: number) => Promise<void> | void;
  signal?: AbortSignal;
}

/** Parts cut mid-sentence (no pause nearby) run on with a space; parts that end a sentence start a new paragraph. */
export function joinParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((text, part) => (!text ? part : /[.!?…:;"'”»)\]]$/.test(text) ? `${text}\n\n${part}` : `${text} ${part}`), '');
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Any audio or video file to text: extract the audio as compact MP3, cut it into parts of about
 * `partSeconds` at pauses, transcribe the parts in order (each with the end of the one before as context),
 * and join them. Every part stays far below the 25 MB upload limit, however long the recording.
 */
export async function transcribeRecording(input: string, options: RecordingOptions): Promise<string> {
  const { ffmpeg, transcriber, partSeconds, signal } = options;
  const directory = await mkdtemp(join(tmpdir(), 'omek-transcribe-'));
  try {
    const audio = await prepareAudio(ffmpeg, input, join(directory, 'audio.mp3'), signal);
    const files = await splitAudio(ffmpeg, audio.file, planParts(audio.duration, audio.silences, partSeconds), directory, signal);
    await options.onProgress?.(0, files.length);

    const texts: string[] = [];
    for (const [index, file] of files.entries()) {
      if ((await stat(file)).size > MAX_UPLOAD_BYTES) {
        throw new TranscriptionError('חלק מההקלטה יצא גדול מ-25 MB. הגדירו TRANSCRIBE_PART_MINUTES נמוך יותר.');
      }
      const previous = joinParts(texts).slice(-400);
      texts.push(await transcriber.transcribe(file, { prompt: previous || undefined, keywords: options.keywords, signal }));
      await options.onProgress?.(index + 1, files.length);
    }
    return joinParts(texts);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
