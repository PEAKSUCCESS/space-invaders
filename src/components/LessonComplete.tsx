import { useEffect } from 'react';
import type { Difficulty } from '../types';
import type { InvadersResult } from '../game/invadersEngine';
import { Fireworks } from './effects/Fireworks';
import { playVictory } from '../lib/sound';
import { t } from '../i18n/i18n';

interface Props {
  onDone: () => void;
  levelUp?: Difficulty | null;
  audio?: boolean;
  timeMs?: number | null;          // total time to complete the game
  flawless?: boolean;              // run had no wrong answers
  ranking?: boolean;               // waiting on the server rank
  rank?: number | null;            // 1-based rank among flawless runs
  totalFlawless?: number | null;   // how many flawless runs exist
  invaders?: InvadersResult;       // a Space Invaders run — ranked by score instead of time
  total?: number | null;           // runs on the score board (with `invaders`)
}

// mm:ss (e.g. 1:24, 0:47).
function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LessonComplete({
  onDone, levelUp, audio = true, timeMs, flawless, ranking, rank, totalFlawless, invaders, total,
}: Props) {
  useEffect(() => {
    if (audio) playVictory();
  }, [audio]);

  return (
    <div className="lesson-complete">
      <Fireworks durationMs={3000} onDone={onDone} />
      <div className="lesson-complete-message">
        {invaders?.gameOver ? t('complete.gameOver') : t('complete.greatJob')}
      </div>
      {levelUp && (
        <div className="lesson-complete-levelup">{t('complete.levelUp', { level: t(`level.${levelUp}`) })}</div>
      )}
      {invaders && (
        <>
          <div className="lesson-complete-time">{t('complete.score', { score: invaders.score.toLocaleString() })}</div>
          <div className="lesson-complete-rank muted">
            {t('complete.accuracy', { pct: Math.round(invaders.accuracy * 100), n: invaders.exposures })}
          </div>
          {invaders.practice ? (
            <div className="lesson-complete-rank muted">{t('complete.practice')}</div>
          ) : ranking ? (
            <div className="lesson-complete-rank muted">{t('complete.rankingScore')}</div>
          ) : rank != null ? (
            <div className="lesson-complete-rank">
              {rank === 1 ? t('complete.highScore') : t('complete.scoreRank', { rank, total: total ?? rank })}
            </div>
          ) : null}
        </>
      )}
      {typeof timeMs === 'number' && (
        <div className="lesson-complete-time">{t('complete.time', { time: formatTime(timeMs) })}</div>
      )}
      {typeof timeMs === 'number' &&
        (flawless ? (
          ranking ? (
            <div className="lesson-complete-rank muted">{t('complete.ranking')}</div>
          ) : rank != null ? (
            <div className="lesson-complete-rank">
              {rank === 1
                ? t('complete.bestTime')
                : t('complete.rank', { rank, total: totalFlawless ?? rank })}
            </div>
          ) : null
        ) : (
          <div className="lesson-complete-rank muted">{t('complete.notRanked')}</div>
        ))}
    </div>
  );
}
