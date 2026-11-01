import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { TranscriptionError } from './errors.js';

export interface Silence {
  start: number;
  end: number;
}

export interface PreparedAudio {
  /** Mono 16 kHz MP3 at 48 kbps: about 21 MB an hour, which speech recognition handles well */
  file: string;
  /** Seconds */
  duration: number;
  /** Pauses in the conversation, where it is safe to cut */
  silences: Silence[];
}

export interface AudioPart {
  start: number;
  end: number;
}

/** Bitrate of the extracted audio. Parts are sized from it, far under the 25 MB upload limit. */
export const AUDIO_BITRATE = 48_000;

/**
 * Runs ffmpeg with the given arguments. Each line it logs goes to `onLine`; on failure the error carries
 * the last lines of the log. Aborting `signal` stops the process.
 */
export function runFfmpeg(
  binary: string,
  args: string[],
  { signal, onLine }: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '';
    const tail: string[] = [];
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-200_000);
    });
    createInterface({ input: child.stderr }).on('line', (line) => {
      onLine?.(line);
      tail.push(line);
      if (tail.length > 25) tail.shift();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new FfmpegFailure(code, tail.join('\n')));
    });
  });
}

export class FfmpegFailure extends Error {
  constructor(
    readonly code: number | null,
    readonly log: string,
  ) {
    super(`ffmpeg exited with ${code}: ${log.split('\n').slice(-3).join(' | ')}`);
    this.name = 'FfmpegFailure';
  }
}

/** Whether `binary` runs (`ffmpeg -version`) within a few seconds */
async function works(binary: string): Promise<boolean> {
  try {
    await runFfmpeg(binary, ['-hide_banner', '-version'], { signal: AbortSignal.timeout(10_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The ffmpeg to use: FFMPEG_PATH when set, then the binary bundled by the ffmpeg-static package
 * (an optional dependency, so hosts without ffmpeg still get one), then `ffmpeg` on the PATH.
 */
export async function findFfmpeg(configured?: string): Promise<string | null> {
  if (configured) return (await works(configured)) ? configured : null;
  // ffmpeg-static exports the binary's path (or null on platforms it has no build for).
  const bundled = await import('ffmpeg-static')
    .then((module: unknown) => (module as { default?: unknown }).default)
    .then((path) => (typeof path === 'string' ? path : null))
    .catch(() => null);
  for (const candidate of [bundled, 'ffmpeg']) {
    if (candidate && (await works(candidate))) return candidate;
  }
  return null;
}

/** Turns ffmpeg's complaints into something the person who uploaded the file can act on. */
function explain(error: unknown): never {
  if (error instanceof FfmpegFailure) {
    if (/matches no streams|does not contain any stream/i.test(error.log)) {
      throw new TranscriptionError('אין פס קול בהקלטה הזו.');
    }
    if (/Invalid data found|could not find codec parameters|moov atom not found|End of file/i.test(error.log)) {
      throw new TranscriptionError('לא הצלחנו לקרוא את הקובץ כאודיו או כווידאו. ייתכן שהוא פגום.');
    }
    console.error('ffmpeg failed:', error.log);
    throw new TranscriptionError('לא הצלחנו לחלץ את האודיו מההקלטה.');
  }
  throw error;
}

/**
 * Extracts the first audio track (from any audio or video file) as compact speech audio, and notes
 * where the pauses are, in one pass.
 */
export async function prepareAudio(ffmpeg: string, input: string, output: string, signal?: AbortSignal): Promise<PreparedAudio> {
  const silences: Silence[] = [];
  let openSilence: number | null = null;
  const onLine = (line: string) => {
    const start = /silence_start: (-?[\d.]+)/.exec(line);
    if (start) openSilence = Math.max(0, Number(start[1]));
    const end = /silence_end: ([\d.]+)/.exec(line);
    if (end && openSilence !== null) {
      silences.push({ start: openSilence, end: Number(end[1]) });
      openSilence = null;
    }
  };
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-i', input,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', '1', '-ar', '16000',
    // Pauses of half a second or more, quieter than -35 dB: background noise on a phone line stays above it.
    '-af', 'silencedetect=noise=-35dB:d=0.5',
    '-c:a', 'libmp3lame', '-b:a', String(AUDIO_BITRATE),
    '-progress', 'pipe:1', '-nostats',
    output,
  ];
  let stdout: string;
  try {
    ({ stdout } = await runFfmpeg(ffmpeg, args, { signal, onLine }));
  } catch (error) {
    explain(error);
  }
  const times = [...stdout.matchAll(/out_time_us=(\d+)/g)].map((match) => Number(match[1]) / 1_000_000);
  return { file: output, duration: times.at(-1) ?? 0, silences };
}

/**
 * Where to cut a recording into parts of about `partSeconds`. Each cut goes in the longest pause within
 * `lookback` seconds before the target, so words aren't split; with no pause there, it cuts at the target.
 * A short remainder (up to 10% of a part) joins the last part rather than becoming one of its own.
 */
export function planParts(duration: number, silences: readonly Silence[], partSeconds: number, lookback = Math.min(120, partSeconds / 4)): AudioPart[] {
  if (!Number.isFinite(duration) || duration <= 0) return [{ start: 0, end: 0 }];
  const parts: AudioPart[] = [];
  let start = 0;
  while (duration - start > partSeconds * 1.1) {
    const target = start + partSeconds;
    const pauses = silences
      .map((silence) => ({ middle: (silence.start + silence.end) / 2, length: silence.end - silence.start }))
      .filter((pause) => pause.middle > Math.max(start + 1, target - lookback) && pause.middle <= target)
      .sort((a, b) => b.length - a.length || b.middle - a.middle);
    const cut = pauses[0]?.middle ?? target;
    parts.push({ start, end: cut });
    start = cut;
  }
  parts.push({ start, end: duration });
  return parts;
}

/** Cuts the prepared audio at the planned points, without re-encoding. Returns the files in order. */
export async function splitAudio(ffmpeg: string, file: string, parts: readonly AudioPart[], directory: string, signal?: AbortSignal) {
  if (parts.length <= 1) return [file];
  const cuts = parts.slice(1).map((part) => part.start.toFixed(3));
  try {
    await runFfmpeg(
      ffmpeg,
      ['-hide_banner', '-nostdin', '-y', '-i', file, '-f', 'segment', '-segment_times', cuts.join(','), '-reset_timestamps', '1', '-c', 'copy', join(directory, 'part-%03d.mp3')],
      { signal },
    );
  } catch (error) {
    explain(error);
  }
  const names = (await readdir(directory)).filter((name) => /^part-\d{3}\.mp3$/.test(name)).sort();
  return names.map((name) => join(directory, name));
}
