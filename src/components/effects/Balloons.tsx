import { useEffect, useMemo } from 'react';

interface Props {
  durationMs?: number;
  count?: number;
  onDone: () => void;
}

const COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#f72585', '#4cc9f0'];

// Module-level (outside render) so the randomness is intentional and the
// react-hooks/purity lint doesn't flag inline Math.random during render.
function makeBalloons(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    left: (i / count) * 100 + Math.random() * 6 - 3,
    delay: Math.random() * 0.6,
    dur: 2.4 + Math.random() * 1.2,
    color: COLORS[i % COLORS.length],
  }));
}

export function Balloons({ durationMs = 3000, count = 16, onDone }: Props) {
  useEffect(() => {
    const t = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(t);
  }, [durationMs, onDone]);

  // Randomized once per mount (not per render) so re-renders don't reshuffle.
  const balloons = useMemo(() => makeBalloons(count), [count]);

  return (
    <div className="balloons-overlay">
      {balloons.map((b, i) => (
        <span
          key={i}
          className="balloon"
          style={{
            left: `${b.left}%`,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
