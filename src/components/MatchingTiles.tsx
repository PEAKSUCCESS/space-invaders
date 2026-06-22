import { useMemo, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { t } from '../i18n/i18n';

interface Props {
  words: ApiWord[];
  language: LanguageCode;
  avatarId: AvatarId;
  pairCount?: number;
  audio?: boolean;
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
}

type Column = 'native' | 'english';

interface Tile {
  id: string;
  senseId: string;
  english: string;
  native: string;
  column: Column;
  state: 'idle' | 'selected' | 'wrong' | 'gone';
}

function nativeOf(w: ApiWord, language: LanguageCode): string {
  return w.translations![language]![0].word;
}

// Module-level so the inline Math.random isn't flagged during render.
const coinFlip = () => Math.random() < 0.5;

const REVEAL_AFTER = 3; // wrong matches on a word before its pair is revealed

export function MatchingTiles({ words, language, avatarId, pairCount = 5, audio = true, onAnswer, onComplete }: Props) {
  // Randomly choose which language sits on the left this mount.
  const [leftIsEnglish] = useState(coinFlip);

  const usable = useMemo(() => words.filter((w) => w.translations?.[language]?.length), [words, language]);

  const initial = useMemo(() => {
    const picked = pickN(usable, Math.min(pairCount, usable.length));
    const native: Tile[] = shuffle(picked).map((w, i) => ({
      id: `n-${i}`,
      senseId: w.senseId,
      english: w.english,
      native: nativeOf(w, language),
      column: 'native',
      state: 'idle',
    }));
    const english: Tile[] = shuffle(picked).map((w, i) => ({
      id: `e-${i}`,
      senseId: w.senseId,
      english: w.english,
      native: nativeOf(w, language),
      column: 'english',
      state: 'idle',
    }));
    return { native, english };
  }, [usable, language, pairCount]);

  const [tiles, setTiles] = useState<{ native: Tile[]; english: Tile[] }>({ native: initial.native, english: initial.english });
  const [matchCount, setMatchCount] = useState(0);
  // Wrong-match attempts per word, and the senseIds whose pair is now revealed.
  const [, setWrongCounts] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<string[]>([]);

  const totalGoal = initial.native.length;

  function setTile(id: string, patch: Partial<Tile>) {
    setTiles((prev) => ({
      native: prev.native.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      english: prev.english.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  function onTileClick(tile: Tile, e: React.MouseEvent<HTMLButtonElement>) {
    if (tile.state === 'gone' || tile.state === 'wrong') return;
    if (audio && tile.column === 'english') speakAvatar(tile.english, avatarId);

    const all = [...tiles.native, ...tiles.english];
    const selected = all.find((t) => t.state === 'selected');

    if (!selected) {
      setTile(tile.id, { state: 'selected' });
      return;
    }

    if (selected.id === tile.id) return;

    // Same column, different tile — swap selection
    if (selected.column === tile.column) {
      setTiles((prev) => ({
        native: prev.native.map((t) => {
          if (t.id === selected.id) return { ...t, state: 'idle' };
          if (t.id === tile.id) return { ...t, state: 'selected' };
          return t;
        }),
        english: prev.english.map((t) => {
          if (t.id === selected.id) return { ...t, state: 'idle' };
          if (t.id === tile.id) return { ...t, state: 'selected' };
          return t;
        }),
      }));
      return;
    }

    // Opposite column — match check
    if (selected.senseId === tile.senseId) {
      // Correct sound once per exercise (the final pair that completes it),
      // played before its confetti.
      if (audio && matchCount + 1 >= totalGoal) playCorrect();
      const rect = e.currentTarget.getBoundingClientRect();
      fireConfetti({ x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight });

      onAnswer(tile.senseId, true, 'translation');

      const nativeId = selected.column === 'native' ? selected.id : tile.id;
      const englishId = selected.column === 'english' ? selected.id : tile.id;

      const nextCount = matchCount + 1;
      setMatchCount(nextCount);
      setTiles((prev) => ({
        native: prev.native.map((t) => (t.id === nativeId ? { ...t, state: 'gone' } : t)),
        english: prev.english.map((t) => (t.id === englishId ? { ...t, state: 'gone' } : t)),
      }));

      if (nextCount >= totalGoal) window.setTimeout(onComplete, 600);
    } else {
      setTile(tile.id, { state: 'wrong' });
      setTile(selected.id, { state: 'idle' });
      window.setTimeout(() => setTile(tile.id, { state: 'idle' }), 1000);
      // Count the miss against the word the user is trying to match (the one
      // selected first); reveal its pair once it's been missed enough times.
      const stuck = selected.senseId;
      setWrongCounts((prev) => {
        const next = (prev[stuck] ?? 0) + 1;
        if (next >= REVEAL_AFTER) setRevealed((r) => (r.includes(stuck) ? r : [...r, stuck]));
        return { ...prev, [stuck]: next };
      });
    }
  }

  const leftTiles = leftIsEnglish ? tiles.english : tiles.native;
  const rightTiles = leftIsEnglish ? tiles.native : tiles.english;
  const leftLabel = (t: Tile) => (leftIsEnglish ? t.english : t.native);
  const rightLabel = (t: Tile) => (leftIsEnglish ? t.native : t.english);

  return (
    <div className="screen matching">
      <h2>{t('match.title')}</h2>
      <div className="match-grid">
        <div className="match-col">
          {leftTiles.map((t) => (
            <TileBtn key={t.id} tile={t} label={leftLabel(t)} reveal={revealed.includes(t.senseId)} onClick={onTileClick} />
          ))}
        </div>
        <div className="match-col">
          {rightTiles.map((t) => (
            <TileBtn key={t.id} tile={t} label={rightLabel(t)} reveal={revealed.includes(t.senseId)} onClick={onTileClick} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TileBtn({ tile, label, reveal, onClick }: { tile: Tile; label: string; reveal: boolean; onClick: (t: Tile, e: React.MouseEvent<HTMLButtonElement>) => void }) {
  if (tile.state === 'gone') return <div className="tile gone" />;
  return (
    <button type="button" className={`tile ${tile.state}${reveal ? ' reveal' : ''}`} onClick={(e) => onClick(tile, e)}>
      {label}
    </button>
  );
}
