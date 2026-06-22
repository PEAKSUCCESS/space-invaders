import { useEffect, useState } from 'react';

interface Props {
  startTime: number;   // ms timestamp the game started
  targetMs: number;    // the time to beat — the leaderboard best, or the config par time
  label?: string;      // small caption, e.g. 'best' or 'par'
}

const R = 29;
const C = 2 * Math.PI * R;

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

// An analog countdown dial that "winds down" toward the target time: the hand
// sweeps and the ring depletes as the elapsed time approaches the target. When
// the target is passed, it goes red and counts up the overage (+m:ss behind).
export function CountdownDial({ startTime, targetMs, label }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const remaining = targetMs - (now - startTime);
  const behind = remaining < 0;
  const frac = targetMs > 0 ? Math.max(0, Math.min(1, remaining / targetMs)) : 0;
  const angle = frac * 360 * (Math.PI / 180); // hand angle, from 12 o'clock
  const hx = 40 + R * Math.sin(angle);
  const hy = 40 - R * Math.cos(angle);
  const color = behind ? '#e23b3b' : frac > 0.5 ? '#2f9e54' : frac > 0.22 ? '#e0902b' : '#e23b3b';

  return (
    <div className={`countdown-dial${behind ? ' behind' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" width="66" height="66">
        <circle cx="40" cy="40" r="37" fill="#fffdf6" stroke="#e2d5b0" strokeWidth="2" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 2 * Math.PI;
          return (
            <line
              key={i}
              x1={40 + 33 * Math.sin(a)} y1={40 - 33 * Math.cos(a)}
              x2={40 + 36.5 * Math.sin(a)} y2={40 - 36.5 * Math.cos(a)}
              stroke="#cbb98d" strokeWidth="1.4"
            />
          );
        })}
        <circle cx="40" cy="40" r={R} fill="none" stroke="#eee3c6" strokeWidth="5" />
        <circle
          cx="40" cy="40" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`} transform="rotate(-90 40 40)"
        />
        <line x1="40" y1="40" x2={hx} y2={hy} stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="40" cy="40" r="12" fill="#fffdf6" />
        <text x="40" y="44.5" textAnchor="middle" fontSize="14" fontWeight="800" fill={color}>
          {behind ? `+${mmss(-remaining)}` : mmss(remaining)}
        </text>
      </svg>
      {label && <div className="countdown-label">{label}</div>}
    </div>
  );
}
