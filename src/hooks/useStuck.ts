import { useEffect, useRef, useState } from 'react';

/** Reports when a sticky element has stuck, using a sentinel placed right above it. */
export function useStuck<T extends HTMLElement>() {
  const sentinelRef = useRef<T>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return { sentinelRef, stuck };
}
