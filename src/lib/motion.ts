/** Shared motion settings, so every transition moves the same way. */
export const SPRING = { type: 'spring', stiffness: 500, damping: 38, mass: 0.9 } as const;

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
