import { useMemo, useState } from 'react';
import type { ApiWord, AvatarId, LanguageCode, Sentence } from '../types';
import { avatarById } from '../data/avatars';
import { AvatarBadge } from './AvatarBadge';
import { speakAvatar, slowedRate } from '../lib/speech';
import { pickN, shuffle } from '../lib/shuffle';
import { Balloons } from './effects/Balloons';
import { playCorrect } from '../lib/sound';
import { VolumeSlider } from './VolumeSlider';
import { t } from '../i18n/i18n';

interface Props {
  version: 'A' | 'B';
  sentence: Sentence;
  distractors: ApiWord[];
  language: LanguageCode;
  avatarId: AvatarId;
  onComplete: () => void;
}

interface WordChip {
  id: string;
  word: string;
}

// A few extra wrong words; the tile count grows with the sentence so every
// target word always has a tile.
const EXTRA_DISTRACTORS = 3;
const REVEAL_AFTER = 3; // failed submits before the correct sentence is revealed

function tokens(s: string): string[] {
  return s.replace(/[.,!?¿¡]/g, '').split(/\s+/).filter(Boolean);
}

export function TranslateWhatYouHear({ version, sentence, distractors, language, avatarId, onComplete }: Props) {
  // Version A: native spoken → build English (target = English tokens)
  // Version B: English spoken → build native (target = native tokens)
  const targetTokens = useMemo(() => tokens(version === 'A' ? sentence.english : sentence.translation ?? ''), [version, sentence]);

  const initialTiles = useMemo<WordChip[]>(() => {
    if (version === 'A') {
      const pool = distractors.map((w) => w.english).filter((w) => !targetTokens.includes(w));
      const distract = pickN(pool, EXTRA_DISTRACTORS);
      return shuffle([...targetTokens, ...distract]).map((w, i) => ({ id: `a-${i}-${w}`, word: w }));
    }
    // Version B — native words. Use translations of distractor words in chosen language.
    const pool: string[] = [];
    for (const w of distractors) {
      const t = w.translations?.[language]?.[0]?.word;
      if (t && !targetTokens.includes(t)) pool.push(t);
    }
    const distract = pickN(pool, EXTRA_DISTRACTORS);
    return shuffle([...targetTokens, ...distract]).map((w, i) => ({ id: `b-${i}-${w}`, word: w }));
  }, [version, distractors, targetTokens, language]);

  const [available, setAvailable] = useState<WordChip[]>(initialTiles);
  const [chosen, setChosen] = useState<WordChip[]>([]);
  const [pressCount, setPressCount] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [showBalloons, setShowBalloons] = useState(false);
  const [, setWrongCount] = useState(0);
  const [revealed, setRevealed] = useState(false);

  function onPlay() {
    const next = pressCount + 1;
    setPressCount(next);
    if (version === 'A') {
      // Speak the native translation in the avatar voice. Start one tier slower
      // than English (press+1) so the first press is already a notch slower;
      // each additional press slows playback further (via playbackRate).
      speakAvatar(sentence.translation ?? '', avatarId, { lang: language, rate: slowedRate(next + 1) });
    } else {
      // Speak English in the avatar voice; each press slows playback.
      speakAvatar(sentence.english, avatarId, { lang: 'en', rate: slowedRate(next) });
    }
  }

  function onTileClick(tile: WordChip) {
    if (shaking) return;
    if (version === 'A') speakAvatar(tile.word, avatarId, { lang: 'en' });
    setAvailable((a) => a.filter((t) => t.id !== tile.id));
    setChosen((c) => [...c, tile]);
  }

  function onChosenClick(tile: WordChip) {
    if (shaking) return;
    setChosen((c) => c.filter((t) => t.id !== tile.id));
    setAvailable((a) => [...a, tile]);
  }

  function onTest() {
    if (chosen.length !== targetTokens.length) {
      triggerShake();
      return;
    }
    const ok = chosen.every((c, i) => c.word === targetTokens[i]);
    if (ok) {
      playCorrect();
      setShowBalloons(true);
      window.setTimeout(onComplete, 3000);
    } else {
      triggerShake();
    }
  }

  function triggerShake() {
    setWrongCount((n) => {
      const next = n + 1;
      if (next >= REVEAL_AFTER) setRevealed(true);
      return next;
    });
    setShaking(true);
    window.setTimeout(() => {
      setAvailable((a) => shuffle([...a, ...chosen]));
      setChosen([]);
      setShaking(false);
    }, 700);
  }

  const avatar = avatarById(avatarId);

  return (
    <div className="screen translate">
      <div className="avatar-row">
        <AvatarBadge avatar={avatar} size={120} />
        <VolumeSlider />
        <button type="button" className="play-btn" onClick={onPlay} aria-label={t('a11y.playSentence')}>
          ▶
        </button>
      </div>

      <div className={`construction${shaking ? ' shaking' : ''}`}>
        {chosen.length === 0 ? (
          Array.from({ length: targetTokens.length }).map((_, i) => <span key={i} className="slot" />)
        ) : (
          chosen.map((t) => (
            <button key={t.id} type="button" className="slot filled removable" onClick={() => onChosenClick(t)}>
              {t.word}
            </button>
          ))
        )}
      </div>

      <div className={`tile-row${shaking ? ' shaking' : ''}`}>
        {available.map((t) => (
          <button key={t.id} type="button" className="tile word-tile" onClick={() => onTileClick(t)}>
            {t.word}
          </button>
        ))}
      </div>

      {revealed && (
        <p className="answer-hint">{t('translate.answerLabel')} <strong>{targetTokens.join(' ')}</strong></p>
      )}

      <button type="button" className="primary-btn" onClick={onTest} disabled={chosen.length === 0 || shaking}>
        {t('common.submit')}
      </button>

      {showBalloons && <Balloons onDone={() => setShowBalloons(false)} />}
    </div>
  );
}
