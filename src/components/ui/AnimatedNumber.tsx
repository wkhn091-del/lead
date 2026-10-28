import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { formatNumber } from '../../lib/format';
import { EASE_OUT } from '../../lib/motion';

/**
 * Rolls to each new value. It starts from 0 on mount, which gives the summary its one load-in moment.
 * Hidden from screen readers; pair it with an sr-only copy of the value.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const current = useMotionValue(reduceMotion ? value : 0);
  const text = useTransform(current, (latest) => formatNumber(Math.round(latest)));

  useEffect(() => {
    if (reduceMotion) {
      current.set(value);
      return;
    }
    const controls = animate(current, value, { duration: 0.9, ease: EASE_OUT });
    return () => controls.stop();
  }, [value, reduceMotion, current]);

  return (
    <motion.span aria-hidden className={className}>
      {text}
    </motion.span>
  );
}
