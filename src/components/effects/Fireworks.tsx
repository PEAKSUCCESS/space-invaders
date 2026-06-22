import { useEffect } from 'react';
import confetti from 'canvas-confetti';

interface Props {
  durationMs?: number;
  onDone: () => void;
}

export function Fireworks({ durationMs = 2000, onDone }: Props) {
  useEffect(() => {
    const end = Date.now() + durationMs;
    const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];
    let raf = 0;
    const tick = () => {
      const remaining = end - Date.now();
      if (remaining <= 0) {
        onDone();
        return;
      }
      confetti({
        particleCount: 20,
        startVelocity: 35,
        spread: 360,
        ticks: 60,
        origin: { x: Math.random(), y: Math.random() * 0.5 },
        colors,
        scalar: 1.0,
      });
      raf = window.setTimeout(tick, 220);
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [durationMs, onDone]);

  return <div className="fireworks-overlay" />;
}
