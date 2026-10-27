import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useFieldDraft, useSaveOnLeave } from '../../hooks/useSaveOnLeave';
import { cn } from '../../lib/cn';
import { inputBase, inputSize } from './styles';

interface InlineInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: string;
  onCommit: (value: string) => void;
  /** Returns an error message, or null when the value is fine */
  validate?: (value: string) => string | null;
}

/**
 * Text field that saves on blur, Enter, or leaving the page, and reverts on Escape. What's typed is kept on this
 * device until it's saved, so a page that closed mid-word brings it back.
 */
export function InlineInput({ value, onCommit, validate, className, ...props }: InlineInputProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useSaveOnLeave(ref);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const save = (text: string) => {
    const next = text.trim();
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const problem = validate?.(next) ?? null;
    setError(problem);
    if (!problem) onCommit(next);
  };
  const kept = useFieldDraft(props.id, value, (text) => {
    setDraft(text);
    save(text);
  });
  const commit = () => {
    kept.forget();
    save(draft);
  };

  const errorId = props.id ? `${props.id}-error` : undefined;

  return (
    <div className={className}>
      <input
        {...props}
        ref={ref}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          kept.keep(event.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            setDraft(value);
            setError(null);
            kept.forget();
          }
        }}
        className={cn(inputBase, inputSize, error && 'ring-2 ring-danger focus:ring-danger')}
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
