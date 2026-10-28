import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { useFieldDraft, useSaveOnLeave } from '../../hooks/useSaveOnLeave';
import { cn } from '../../lib/cn';
import { inputBase } from './styles';

interface InlineTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: string;
  onCommit: (value: string) => void;
}

/**
 * Multi-line field that saves when it loses focus (or the page is left) and reverts on Escape. What's typed is
 * kept on this device until it's saved, so a page that closed mid-sentence brings it back and saves it.
 */
export function InlineTextarea({ value, onCommit, className, ...props }: InlineTextareaProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useSaveOnLeave(ref);
  const kept = useFieldDraft(props.id, value, (text) => {
    setDraft(text);
    if (text.trim() !== value) onCommit(text.trim());
  });

  return (
    <textarea
      {...props}
      ref={ref}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        kept.keep(event.target.value);
      }}
      onBlur={() => {
        const next = draft.trim();
        kept.forget();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDraft(value);
          kept.forget();
        }
      }}
      className={cn(inputBase, 'block resize-y px-3.5 py-3 text-base leading-relaxed sm:text-[14.5px]', className)}
    />
  );
}
