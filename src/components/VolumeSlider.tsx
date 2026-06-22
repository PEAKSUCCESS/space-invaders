import { useState } from 'react';
import { getVolume, setVolume } from '../lib/speech';
import { t } from '../i18n/i18n';

export function VolumeSlider() {
  const [v, setV] = useState(getVolume());
  const icon = v === 0 ? '🔇' : v < 0.34 ? '🔈' : v < 0.67 ? '🔉' : '🔊';
  return (
    <label className="vol-slider" title={t('a11y.volume')}>
      <span aria-hidden>{icon}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value);
          setV(next);
          setVolume(next);
        }}
        aria-label={t('a11y.volume')}
      />
      <span className="vol-pct">{Math.round(v * 100)}%</span>
    </label>
  );
}
