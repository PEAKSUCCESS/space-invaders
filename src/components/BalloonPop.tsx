import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { BalloonRound } from '../game/lesson';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { t } from '../i18n/i18n';

interface Props {
  rounds: BalloonRound[];
  pool: ApiWord[];                 // bin — source of the English distractor words
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
}

const BALLOON_COUNT = 6;          // balloons per round (1 correct + distractors)
const FLOAT_SECONDS = 8.8;        // CSS rise duration of each balloon (10% slower)
const ADVANCE_DELAY_MS = 750;     // show the pop/confetti before the next round
const DELAY_MAX_S = 1.8;          // random head start so balloons don't rise in a row
const SIZE_MIN = 0.9;             // per-balloon scale range (breaks up the uniform look)
const SIZE_MAX = 1.15;

// A roomy palette; each round shuffles it and hands out distinct colours, so a
// given word/position never keeps the same colour from round to round.
const COLORS = [
  '#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#52a675', '#06d6a0',
  '#1982c4', '#118ab2', '#4cc9f0', '#6a4c93', '#9b5de5', '#f72585',
];

interface BalloonSpec {
  id: string;
  word: string;
  correct: boolean;
  left: number;   // %
  delay: number;  // s
  size: number;   // scale multiplier
  color: string;
}

// Scattered horizontal positions that never overlap: lay the balloons out left to
// right with a fixed minimum width each, then sprinkle the leftover space into the
// gaps at random so spacing is uneven (not a grid). Shuffling the result randomizes
// which balloon lands where, so the correct one isn't in a predictable spot.
function scatterLefts(n: number): number[] {
  const MIN = 3, MAX = 89, WIDTH = 11; // WIDTH ≈ widest balloon as a % of the viewport
  const slack = Math.max(0, MAX - MIN - (n - 1) * WIDTH);
  const weights = Array.from({ length: n }, () => Math.random());
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const lefts: number[] = [];
  let cursor = MIN;
  for (let i = 0; i < n; i++) {
    cursor += (weights[i] / sum) * slack; // random extra gap before this balloon
    lefts.push(cursor);
    cursor += WIDTH;
  }
  return shuffle(lefts);
}

// Module-level (Math.random outside render) so react-hooks/purity stays quiet
// and a re-render doesn't reshuffle the wave mid-flight. Colour, position, start
// delay and size are all randomized per balloon so each wave looks different and
// the correct balloon isn't in a predictable spot/colour.
function makeBalloons(correctWord: string, distractors: string[]): BalloonSpec[] {
  const words = shuffle([
    { word: correctWord, correct: true },
    ...distractors.map((w) => ({ word: w, correct: false })),
  ]);
  const colors = shuffle(COLORS);
  const lefts = scatterLefts(words.length);
  return words.map((w, i) => ({
    id: `b${i}-${w.word}`,
    word: w.word,
    correct: w.correct,
    left: lefts[i],
    delay: Math.random() * DELAY_MAX_S,
    size: SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN),
    color: colors[i % colors.length],
  }));
}

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

export function BalloonPop({ rounds, pool, language, avatarId, audio = true, onAnswer, onComplete }: Props) {
  const total = rounds.length;
  const [roundIndex, setRoundIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState(0);
  // Map of `${roundIndex}:${balloonId}` → how it popped. Keying by round index
  // means past rounds' pops are simply never looked up — no per-round reset
  // (which would be a setState-in-effect) is needed.
  const [popped, setPopped] = useState<Record<string, 'correct' | 'wrong'>>({});
  const resolvedRef = useRef(false);  // round settled (correct pop or timeout)
  const answeredRef = useRef(false);  // first interaction graded to the API
  const fieldRef = useRef<HTMLDivElement>(null);

  const round = rounds[roundIndex];
  const mode: AnswerMode = round.promptKind === 'word' ? 'translation' : 'identification';
  const popKey = (id: string) => `${roundIndex}:${id}`;

  const balloons = useMemo(() => {
    const correctWord = rounds[roundIndex].target.english;
    const seen = new Set<string>([correctWord]);
    const distractorPool: string[] = [];
    for (const w of pool) {
      if (seen.has(w.english)) continue;
      seen.add(w.english);
      distractorPool.push(w.english);
    }
    return makeBalloons(correctWord, pickN(distractorPool, BALLOON_COUNT - 1));
  }, [rounds, roundIndex, pool]);

  function advance() {
    if (roundIndex + 1 >= total) onComplete();
    else setRoundIndex((i) => i + 1);
  }

  // Settle the round as a miss. Triggered when the correct balloon finishes
  // rising off-screen (its onAnimationEnd) — so the balloon stays poppable for as
  // long as any part of it is visible — or by the safety-net timer below.
  function endRoundAsMiss() {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    if (!answeredRef.current) onAnswer(round.target.senseId, false, mode);
    setMissed((m) => m + 1);
    window.setTimeout(advance, ADVANCE_DELAY_MS);
  }

  // Reset per-round flags whenever the round changes. The round normally ends on
  // the correct balloon's onAnimationEnd; this timer is only a safety net (e.g.
  // the tab was backgrounded and the animation event never fired), set well past
  // the expected exit so it never cuts off a still-visible balloon.
  useEffect(() => {
    resolvedRef.current = false;
    answeredRef.current = false;
    const correctBalloon = balloons.find((b) => b.correct);
    const safetyMs = ((correctBalloon?.delay ?? 0) + FLOAT_SECONDS + 2) * 1000;
    const timer = window.setTimeout(endRoundAsMiss, safetyMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex]);

  function popBalloon(b: { id: string; correct: boolean; word: string }, clientX: number, clientY: number) {
    if (resolvedRef.current || popped[popKey(b.id)]) return;

    // Grade the first interaction of the round (one answer submitted per word).
    if (!answeredRef.current) {
      onAnswer(round.target.senseId, b.correct, mode);
      answeredRef.current = true;
    }

    if (b.correct) {
      resolvedRef.current = true;
      setCorrect((c) => c + 1);
      setPopped((p) => ({ ...p, [popKey(b.id)]: 'correct' }));
      fireConfetti({ x: clientX / window.innerWidth, y: clientY / window.innerHeight });
      if (audio) {
        // The final round's victory trumpet covers the celebration sound.
        if (roundIndex + 1 < total) playCorrect();
        speakAvatar(b.word, avatarId);
      }
      window.setTimeout(advance, ADVANCE_DELAY_MS);
    } else {
      // Wrong guess: count a miss, pop just this balloon, let the round continue.
      setMissed((m) => m + 1);
      setPopped((p) => ({ ...p, [popKey(b.id)]: 'wrong' }));
    }
  }

  // Pop by geometry rather than the browser's element hit-testing: walk the
  // balloons and test the pointer against each one's LIVE rendered rect
  // (getBoundingClientRect reflects the in-flight rising animation). A plain click
  // needs press+release on the same node, and element hit-testing can lag a
  // transform animation — both miss when the cursor and balloon are moving.
  function hitTestPop(clientX: number, clientY: number) {
    if (resolvedRef.current) return;
    const field = fieldRef.current;
    if (!field) return;
    const nodes = field.querySelectorAll<HTMLElement>('.bp-balloon');
    // Topmost first — later siblings paint on top.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const id = node.dataset.bid;
      if (!id || popped[popKey(id)]) continue;
      const r = node.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        popBalloon({ id, correct: node.dataset.correct === 'true', word: node.dataset.word ?? '' }, clientX, clientY);
        return;
      }
    }
  }

  // Pop only on press, and only when the press lands on a balloon (geometry
  // hit-test above handles a moving cursor at the moment of the press). No
  // drag-to-pop: holding the button and sweeping across balloons must NOT pop
  // them — that would be cheating.
  function onFieldPointerDown(e: React.PointerEvent) {
    hitTestPop(e.clientX, e.clientY);
  }

  return (
    <div className="balloon-game">
      <div className="balloon-hud">
        <span className="bp-stat correct">{t('balloon.correct')}: {correct}</span>
        <span className="bp-round">{t('balloon.round', { n: roundIndex + 1, total })}</span>
        <span className="bp-stat missed">{t('balloon.missed')}: {missed}</span>
      </div>

      <div className="balloon-field" key={roundIndex} ref={fieldRef} onPointerDown={onFieldPointerDown}>
        {balloons.map((b) => {
          const state = popped[popKey(b.id)];
          return (
            <button
              key={b.id}
              type="button"
              data-bid={b.id}
              data-correct={b.correct}
              data-word={b.word}
              className={`bp-balloon${state ? ' popped' : ''}${state === 'wrong' ? ' wrong' : ''}`}
              style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${FLOAT_SECONDS}s` }}
              onAnimationEnd={(e) => { if (b.correct && e.animationName === 'bp-rise') endRoundAsMiss(); }}
            >
              <span
                className="bp-balloon-inner"
                style={{ background: b.color, width: `${104 * b.size}px`, height: `${124 * b.size}px`, fontSize: `${16 * b.size}px` }}
              >{b.word}</span>
            </button>
          );
        })}
      </div>

      <div className="balloon-prompt">
        <p className="balloon-instruction">{t('balloon.instruction')}</p>
        {round.promptKind === 'image' ? (
          <div className="balloon-prompt-card image">
            {imageUrl(round.target) && <img src={imageUrl(round.target)!} alt="" className="balloon-prompt-img" />}
          </div>
        ) : (
          <div className="balloon-prompt-card">
            <span className="balloon-prompt-word">{nativeOf(round.target, language)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
