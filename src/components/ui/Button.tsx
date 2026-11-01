import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_-12px_var(--primary-glow)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-field text-fg ring-1 ring-inset ring-line hover:bg-field-hover hover:ring-line-strong',
  ghost: 'text-fg-muted hover:bg-field hover:text-fg',
  danger: 'text-danger hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 gap-1.5 rounded-[10px] px-3 text-[13.5px]',
  md: 'h-11 gap-2 rounded-xl px-4 text-[14.5px]',
  icon: 'size-10 rounded-xl',
};

interface StyleOptions {
  variant?: Variant;
  size?: Size;
  className?: string;
}

/** Button classes, also used for links that look like buttons. */
export function buttonStyles({ variant = 'secondary', size = 'md', className }: StyleOptions = {}) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,box-shadow,color,filter,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Omit<StyleOptions, 'className'>;

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}

/** A key name, kept left to right inside Hebrew text ("Ctrl K") */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-[color-mix(in_oklab,currentColor_14%,transparent)] px-1 font-sans text-[11px] font-medium opacity-80',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
