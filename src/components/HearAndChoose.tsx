import { useMemo, useState } from 'react';
import type { ApiWord, AvatarId, Sentence } from '../types';
import { avatarById } from '../data/avatars';
import { AvatarBadge } from './AvatarBadge';
import { speakAvatar, slowedRate } from '../lib/speech';
import { pickN, shuffle } from '../lib/shuffle';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { VolumeSlider } from './VolumeSlider';
import { t } from '../i18n/i18n';

interface Props {
  sentence: Sentence;
  distractors: ApiWord[];
  avatarId: AvatarId;
  onComplete: () => void;
}

interface WordChip {
  id: string;
  word: string;
}

// A few extra wrong words on top of the sentence's own words; the tile count
// grows with the sentence so every target word always has a tile.
const EXTRA_DISTRACTORS = 3;
const REVEAL_AFTER = 3; // wrong taps before the next correct word is revealed

function tokens(sentence: string): string[] {
  return sentence.replace(/[.,!?]/g, '').split(/\s+/).filter(Boolean);
}

export function HearAndChoose({ sentence, distractors, avatarId, onComplete }: Props) {
  const target = useMemo(() => tokens(sentence.english), [sentence]);

  const initialTiles = useMemo<WordChip[]>(() => {
    const distractorWords = pickN(
      distractors.map((w) => w.english).filter((w) => !target.includes(w)),
      EXTRA_DISTRACTORS,
    );
    const all = shuffle([...target, ...distractorWords]);
    return all.map((w, i) => ({ id: `t-${i}-${w}`, word: w }));
  }, [distractors, target]);

  const [available, setAvailable] = useState<WordChip[]>(initialTiles);
  const [chosen, setChosen] = useState<WordChip[]>([]);
  const [wrongId, setWrongId] = useState<string | null>(null);
  const [pressCount, setPressCount] = useState(0);
  const [, setWrongCount] = useState(0);
  const [revealed, setRevealed] = useState(false);

  function onPlay() {
    const next = pressCount + 1;
    setPressCount(next);
    // English sentence in the shopper's avatar voice; each press slows playback.
    speakAvatar(sentence.english, avatarId, { lang: 'en', rate: slowedRate(next) });
  }

  function onTileClick(tile: WordChip) {
    if (wrongId) return;
    const expected = target[chosen.length];
    const isLast = tile.word === expected && chosen.length + 1 === target.length;

    if (isLast) {
      setAvailable((a) => a.filter((t) => t.id !== tile.id));
      setChosen((c) => [...c, tile]);
      playCorrect();
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      fireConfetti({ x: cx / window.innerWidth, y: cy / window.innerHeight });
      // Advance only once the final word has actually been spoken — otherwise
      // the next step mounts and interrupts the shared audio, clipping it. The
      // timeout is a safety net if 'ended' never fires (audio error, etc.).
      let advanced = false;
      const go = () => {
        if (advanced) return;
        advanced = true;
        onComplete();
      };
      speakAvatar(tile.word, avatarId, { lang: 'en', onEnd: () => window.setTimeout(go, 300) });
      window.setTimeout(go, 2500);
      return;
    }

    speakAvatar(tile.word, avatarId, { lang: 'en' });
    if (tile.word === expected) {
      setAvailable((a) => a.filter((t) => t.id !== tile.id));
      setChosen((c) => [...c, tile]);
    } else {
      setWrongId(tile.id);
      window.setTimeout(() => setWrongId(null), 1000);
      setWrongCount((n) => {
        const next = n + 1;
        if (next >= REVEAL_AFTER) setRevealed(true);
        return next;
      });
    }
  }

  // Once revealed, highlight one tile for the next word still to be placed.
  const nextExpected = target[chosen.length];
  const revealTileId = revealed && nextExpected
    ? available.find((t) => t.word === nextExpected)?.id ?? null
    : null;

  const avatar = avatarById(avatarId);

  return (
    <div className="screen choose">
      <div className="avatar-row">
        <AvatarBadge avatar={avatar} size={120} />
        <VolumeSlider />
        <button type="button" className="play-btn" onClick={onPlay} aria-label={t('a11y.playSentence')}>
          ▶
        </button>
      </div>

      <div className="construction">
        {Array.from({ length: target.length }).map((_, i) => (
          <span key={i} className={`slot${chosen[i] ? ' filled' : ''}`}>{chosen[i]?.word ?? ''}</span>
        ))}
      </div>

      <div className="tile-row">
        {available.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tile word-tile${wrongId === t.id ? ' wrong' : ''}${revealTileId === t.id ? ' reveal' : ''}`}
            onClick={() => onTileClick(t)}
          >
            {t.word}
          </button>
        ))}
      </div>
    </div>
  );
}
