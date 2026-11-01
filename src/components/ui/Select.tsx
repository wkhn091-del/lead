import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { inputBase } from './styles';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes for the wrapper; the select fills it */
  className?: string;
  selectClassName?: string;
}

/** A native select styled like the other fields, so phones keep their own picker. */
export function Select({ className, selectClassName, children, ...props }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        className={cn(inputBase, 'h-11 appearance-none ps-3.5 pe-9 text-base sm:text-[14.5px]', selectClassName)}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 text-fg-faint"
        aria-hidden
      />
    </div>
  );
}
