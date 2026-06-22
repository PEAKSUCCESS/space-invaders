import { useEffect, useMemo, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import { avatarById } from '../data/avatars';
import { AvatarBadge } from './AvatarBadge';
import { speakAvatar } from '../lib/speech';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { VolumeSlider } from './VolumeSlider';
import { t } from '../i18n/i18n';

// enToNat  — show English word, pick the native translation  (translation)
// natToEn  — show native word,  pick the English word         (translation)
// defToEn  — show English definition, pick the English word   (definition)
// hearToEn — hear the English word, pick the English word      (identification)
// imgToEn  — show the word's image, pick the English word      (identification)
export type PickMode = 'enToNat' | 'natToEn' | 'defToEn' | 'hearToEn' | 'imgToEn';

const API_MODE: Record<PickMode, AnswerMode> = {
  enToNat: 'translation',
  natToEn: 'translation',
  defToEn: 'definition',
  hearToEn: 'identification',
  imgToEn: 'identification',
};

interface Props {
  mode: PickMode;
  target: ApiWord;
  pool: ApiWord[];
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
}

const TILE_COUNT = 8;
const REVEAL_AFTER = 3; // wrong picks before the correct tile is revealed
const SPEAK_DELAY_MS = 500; // let the screen render before auto-speaking the word

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

function nativeDefOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.definition;
}

function capitalizeFirst(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function PickOne({ mode, target, pool, language, avatarId, audio = true, onAnswer, onComplete }: Props) {
  const tilesAreEnglish = mode !== 'enToNat';

  const tiles = useMemo(() => {
    const correctWord = tilesAreEnglish ? target.english : nativeOf(target, language);
    if (!correctWord) return [];

    const seen = new Set<string>([correctWord]);
    const distractorPool: string[] = [];
    for (const w of pool) {
      const candidate = tilesAreEnglish ? w.english : nativeOf(w, language);
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      distractorPool.push(candidate);
    }
    const distractors = pickN(distractorPool, Math.max(0, TILE_COUNT - 1));
    return shuffle([correctWord, ...distractors]).map((word, i) => ({
      id: `t${i}-${word}`,
      word,
      correct: word === correctWord,
    }));
  }, [target, pool, language, tilesAreEnglish]);

  const [wrongId, setWrongId] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [, setWrongCount] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Nothing renderable (e.g. translation mode but no translation) — skip the step.
  useEffect(() => {
    if (tiles.length === 0) window.setTimeout(onComplete, 0);
  }, [tiles.length, onComplete]);

  // Auto-speak the English word: always for hear-the-word, and for enToNat when
  // audio is on (the ▶ on the prompt just replays it). Delay it briefly so the
  // screen renders first — otherwise the word starts before the tiles appear.
  useEffect(() => {
    if (mode === 'hearToEn' || (mode === 'enToNat' && audio)) {
      const t = window.setTimeout(() => speakAvatar(target.english, avatarId), SPEAK_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [mode, target, audio, avatarId]);

  if (tiles.length === 0) return null;

  function onTileClick(tileId: string, correct: boolean, word: string) {
    if (solved) return;
    const speaks = audio && tilesAreEnglish;

    // Grade on the first attempt only; let the user keep trying afterward.
    if (!answered) {
      onAnswer(target.senseId, correct, API_MODE[mode]);
      setAnswered(true);
    }

    if (correct) {
      setSolved(true);
      fireConfetti({ x: 0.5, y: 0.5 });
      // Speak the tapped word first, then play the celebration chime, then
      // advance — the shopper hears the word before the sound. Advance only
      // after the word finishes, else the next step mounts and interrupts the
      // shared audio, clipping it. Safety-net timeout in case 'ended' never
      // fires (audio error, etc.).
      let advanced = false;
      const go = () => {
        if (advanced) return;
        advanced = true;
        onComplete();
      };
      const celebrateThenGo = (delay: number) => {
        if (audio) playCorrect();
        window.setTimeout(go, delay);
      };
      if (speaks) {
        speakAvatar(word, avatarId, { onEnd: () => celebrateThenGo(500) });
        window.setTimeout(go, 2500);
      } else {
        celebrateThenGo(700);
      }
    } else {
      if (speaks) speakAvatar(word, avatarId);
      setWrongId(tileId);
      window.setTimeout(() => setWrongId(null), 800);
      setWrongCount((n) => {
        const next = n + 1;
        if (next >= REVEAL_AFTER) setRevealed(true);
        return next;
      });
    }
  }

  return (
    <div className="screen pickone">
      {(mode === 'natToEn' || mode === 'defToEn') && (
        <p className="pickone-instruction">{t('pick.clickEnglish')}</p>
      )}
      <Prompt mode={mode} target={target} language={language} avatarId={avatarId} audio={audio} />

      <div className="tile-row">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tile word-tile${wrongId === t.id ? ' wrong' : ''}${solved && t.correct ? ' selected' : ''}${revealed && t.correct && !solved ? ' reveal' : ''}`}
            onClick={() => onTileClick(t.id, t.correct, t.word)}
          >
            {t.word}
          </button>
        ))}
      </div>
    </div>
  );
}

interface PromptProps {
  mode: PickMode;
  target: ApiWord;
  language: LanguageCode;
  avatarId: AvatarId;
  audio: boolean;
}

function Prompt({ mode, target, language, avatarId, audio }: PromptProps) {
  if (mode === 'imgToEn') {
    const src = imageUrl(target);
    return (
      <div className="pickone-prompt image">
        {src && <img src={src} alt="" className="pickone-image" />}
      </div>
    );
  }

  if (mode === 'defToEn') {
    // Native-language definition only — never the English one.
    return (
      <div className="pickone-prompt text">
        <span className="pickone-def">{capitalizeFirst(nativeDefOf(target, language))}</span>
      </div>
    );
  }

  if (mode === 'natToEn') {
    return (
      <div className="pickone-prompt text">
        <span className="pickone-word">{nativeOf(target, language)}</span>
      </div>
    );
  }

  if (mode === 'enToNat') {
    const replay = () => speakAvatar(target.english, avatarId);
    return (
      <div className="pickone-prompt text">
        {audio ? (
          <button type="button" className="pickone-word replay" onClick={replay} aria-label={t('a11y.replayWord')}>
            {target.english} <span className="replay-icon">▶</span>
          </button>
        ) : (
          <span className="pickone-word">{target.english}</span>
        )}
      </div>
    );
  }

  // hearToEn — audio prompt
  const avatar = avatarById(avatarId);
  return (
    <div className="pickone-prompt audio">
      <div className="avatar-row">
        <AvatarBadge avatar={avatar} size={120} />
        <VolumeSlider />
        <button type="button" className="play-btn" onClick={() => speakAvatar(target.english, avatarId)} aria-label={t('a11y.playWord')}>▶</button>
      </div>
    </div>
  );
}
