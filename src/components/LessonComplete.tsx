import { useEffect } from 'react';
import type { Difficulty } from '../types';
import { Fireworks } from './effects/Fireworks';
import { playVictory } from '../lib/sound';
import { t } from '../i18n/i18n';

interface Props {
  onDone: () => void;
  levelUp?: Difficulty | null;
  audio?: boolean;
}

export function LessonComplete({ onDone, levelUp, audio = true }: Props) {
  useEffect(() => {
    if (audio) playVictory();
  }, [audio]);

  return (
    <div className="lesson-complete">
      <Fireworks durationMs={3000} onDone={onDone} />
      <div className="lesson-complete-message">{t('complete.greatJob')}</div>
      {levelUp && (
        <div className="lesson-complete-levelup">{t('complete.levelUp', { level: t(`level.${levelUp}`) })}</div>
      )}
    </div>
  );
}
