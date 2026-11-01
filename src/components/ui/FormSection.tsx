import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface FormSectionProps {
  /** Id for the title, so a field without its own label (the strategy notes) can be named by it */
  titleId: string;
  title: string;
  icon: LucideIcon;
  /** Controls for the whole section, at the end of its title row: the deal's currency */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A group of related fields under a titled rule: the business, the contact, the strategy, the deal. */
export function FormSection({ titleId, title, icon: Icon, aside, className, children }: FormSectionProps) {
  return (
    <div role="group" aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <div className={cn('mb-3 flex items-center gap-2.5', aside ? 'min-h-9' : 'min-h-6')}>
        <Icon className="size-4 shrink-0 text-fg-faint" aria-hidden />
        <h3 id={titleId} className="text-[14px] font-semibold tracking-[-0.005em] text-fg">
          {title}
        </h3>
        <span aria-hidden className="h-px min-w-6 flex-1 bg-line" />
        {aside}
      </div>
      {children}
    </div>
  );
}
