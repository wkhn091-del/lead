import { AudioLines, Download, FileAudio, LoaderCircle, Pause, Play, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { repository } from '../../data/repository';
import { cn } from '../../lib/cn';
import { formatBytes, formatDuration } from '../../lib/media';
import { toneStyle } from '../../lib/stages';
import { isTranscribing, transcriptionProgress } from '../../lib/timeline';
import type { MediaFile } from '../../types';
import { Button } from '../ui/Button';

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** One recording plays at a time: starting another pauses the last. */
let playing: HTMLMediaElement | null = null;
function claimPlayback(element: HTMLMediaElement) {
  if (playing && playing !== element) playing.pause();
  playing = element;
}

/** The playable URL for a recording: a link to the server, or a file kept in this browser. */
function useMediaSource(media: MediaFile) {
  const [state, setState] = useState<{ src: string | null; error: string | null }>({ src: null, error: null });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    repository
      .mediaSource(media)
      .then((value) => {
        if (cancelled) return repository.releaseMediaSource(value);
        url = value;
        setState({ src: value, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ src: null, error: error instanceof Error ? error.message : 'אי אפשר לנגן את ההקלטה הזו.' });
      });
    return () => {
      cancelled = true;
      if (url) repository.releaseMediaSource(url);
    };
    // The id names the file; a new object for the same recording needs no new source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);
  return state;
}

interface MediaPlayerProps {
  media: MediaFile;
  onRemove?: () => void;
  /** Offers to transcribe the recording (one never transcribed, or whose transcript failed) */
  onTranscribe?: () => void;
  /** Shows the transcript's progress here, for recordings without a timeline entry to show it on */
  showTranscription?: boolean;
  className?: string;
}

/** A call recording with a compact player (speed control for reviewing calls), or a Zoom video. */
export function MediaPlayer({ media, onRemove, onTranscribe, showTranscription, className }: MediaPlayerProps) {
  const { src, error } = useMediaSource(media);
  const tone = media.kind === 'video' ? 'var(--st-zoom)' : 'var(--st-answered)';

  return (
    <figure style={toneStyle(tone)} className={cn('rounded-2xl bg-field ring-1 ring-line ring-inset', className)}>
      {media.kind === 'video' && src && !error ? (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          onPlay={(event) => claimPlayback(event.currentTarget)}
          className="aspect-video max-h-[340px] w-full rounded-t-2xl bg-black object-contain"
        />
      ) : media.kind === 'audio' && src && !error ? (
        <AudioControls src={src} label={media.fileName} />
      ) : null}
      <figcaption className="flex min-w-0 items-center gap-2 px-3 py-2 text-[12.5px] text-fg-muted">
        {error ? (
          <TriangleAlert className="size-3.5 shrink-0 text-danger" aria-hidden />
        ) : !src ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <FileAudio className="size-3.5 shrink-0" style={{ color: tone }} aria-hidden />
        )}
        <span dir="auto" className="min-w-0 truncate" title={media.fileName}>
          {error ?? media.fileName}
        </span>
        <span className="shrink-0 text-fg-faint tabular-nums">{formatBytes(media.size)}</span>
        <span className="ms-auto flex shrink-0 items-center">
          {onTranscribe && (
            <button
              type="button"
              onClick={onTranscribe}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-fg-muted hover:bg-field-hover hover:text-fg"
            >
              <AudioLines className="size-4" aria-hidden />
              {media.transcription?.status === 'failed' ? 'לנסות שוב' : 'תמלול'}
            </button>
          )}
          {src && (
            <a
              href={src}
              download={media.fileName}
              aria-label={`הורדת ${media.fileName}`}
              className="flex size-8 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover hover:text-fg"
            >
              <Download className="size-4" aria-hidden />
            </a>
          )}
          {onRemove && <RemoveButton label={media.fileName} onConfirm={onRemove} />}
        </span>
      </figcaption>
      {showTranscription && isTranscribing(media) && (
        <p aria-live="polite" className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12.5px] text-fg-muted">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[var(--st-answered)]" aria-hidden />
          <span className="font-medium text-fg">מתמלל…</span>
          <span className="text-fg-faint">{transcriptionProgress(media)}. התמלול יתווסף כהערה בציר הזמן.</span>
        </p>
      )}
      {showTranscription && media.transcription?.status === 'failed' && (
        <p role="alert" className="flex items-start gap-2 border-t border-line px-3 py-2 text-[12.5px]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-medium">לא הצלחנו לתמלל.</span> <span className="text-fg-muted">{media.transcription.error}</span>
          </span>
        </p>
      )}
    </figure>
  );
}

function AudioControls({ src, label }: { src: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);

  const known = Number.isFinite(duration) && duration > 0;
  const progress = known ? Math.min(100, (time / duration) * 100) : 0;

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      claimPlayback(element);
      void element.play().catch(() => setFailed(true));
    } else element.pause();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  // Playback controls keep left-to-right in Hebrew too: time runs that way on every player.
  return (
    <div dir="ltr" className="flex items-center gap-3 px-3 pt-3 pb-1">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={failed}
        aria-label={paused ? `ניגון ${label}` : `השהיה ${label}`}
        className="tone-chip flex size-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-45"
      >
        {paused ? <Play className="size-4 translate-x-px" fill="currentColor" aria-hidden /> : <Pause className="size-4" fill="currentColor" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={known ? duration : 0}
          step={0.1}
          value={known ? time : 0}
          disabled={!known || failed}
          aria-label={`מיקום בהקלטה ${label}`}
          aria-valuetext={`${formatDuration(time)} מתוך ${formatDuration(duration)}`}
          onChange={(event) => {
            const next = Number(event.target.value);
            setTime(next);
            if (audio.current) audio.current.currentTime = next;
          }}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          className="seek block w-full"
        />
        <p className="flex justify-between text-[11.5px] text-fg-faint tabular-nums">
          <span dir="rtl">{failed ? 'הדפדפן לא יכול לנגן את הפורמט הזה' : formatDuration(time)}</span>
          <span>{known ? formatDuration(duration) : ''}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={`מהירות ניגון ${speed}×`}
        className="h-8 min-w-11 shrink-0 rounded-lg px-2 text-[12.5px] font-semibold tabular-nums text-fg-muted ring-1 ring-line ring-inset hover:bg-field-hover hover:text-fg"
      >
        {speed}×
      </button>
    </div>
  );
}

/** Deleting a recording can't be undone, so it asks once more. */
function RemoveButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(timer);
  }, [asking]);

  return asking ? (
    <Button size="sm" variant="danger" onClick={onConfirm} className="h-8">
      למחוק לצמיתות
    </Button>
  ) : (
    <button
      type="button"
      onClick={() => setAsking(true)}
      aria-label={`מחיקת ${label}`}
      className="flex size-8 items-center justify-center rounded-lg text-fg-faint hover:bg-field-hover hover:text-danger"
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
