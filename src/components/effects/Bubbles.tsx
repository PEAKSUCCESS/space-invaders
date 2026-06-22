import { useEffect, useMemo } from 'react';

interface Props {
  durationMs?: number;
  count?: number;
  onDone: () => void;
}

// Module-level (outside render) so the randomness is intentional and the
// react-hooks/purity lint doesn't flag inline Math.random during render.
function makeBubbles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    left: (i / count) * 100 + Math.random() * 6 - 3,
    delay: Math.random() * 0.6,
    dur: 2.2 + Math.random() * 1.4,
    size: 14 + Math.random() * 28,
  }));
}

/** A celebratory burst of water bubbles rising up the screen, shown on a
 *  sentence-game win. */
export function Bubbles({ durationMs = 3000, count = 18, onDone }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(t);
  }, [durationMs, onDone]);

  // Randomized once per mount (not per render) so re-renders don't reshuffle.
  const bubbles = useMemo(() => makeBubbles(count), [count]);

  return (
    <div className="bubbles-overlay">
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            left: `${b.left}%`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
