/** Rings dropping into still water: "omek" is Hebrew for depth. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="11" fill="var(--primary)" />
      <circle cx="18" cy="18" r="10" fill="none" stroke="var(--primary-fg)" strokeWidth="1.5" opacity="0.28" />
      <circle cx="18" cy="18" r="6.25" fill="none" stroke="var(--primary-fg)" strokeWidth="1.5" opacity="0.6" />
      <circle cx="18" cy="18" r="2.6" fill="var(--primary-fg)" />
    </svg>
  );
}
