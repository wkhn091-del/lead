import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { labelText } from './styles';

interface FieldProps {
  label: string;
  /** Id of the control; omit for groups that carry their own aria-label */
  htmlFor?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, className, children }: FieldProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={cn(labelText, 'mb-1.5 block')}>
          {label}
        </label>
      ) : (
        <p className={cn(labelText, 'mb-1.5')}>{label}</p>
      )}
      {children}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="mt-1.5 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
