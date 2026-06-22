import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { ClimbRound } from '../game/lesson';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { avatarById } from '../data/avatars';
import { t } from '../i18n/i18n';

interface Props {
  rounds: ClimbRound[];
  pool: ApiWord[];                 // bin — source of the English distractor words
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  paused?: boolean;                // freeze the rising water (e.g. feedback modal open)
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
}

const HOLD_COUNT = 6;             // handholds per round (1 correct + distractors)
const ADVANCE_DELAY_MS = 750;    // celebrate the climb before the next round

// Survival model. `buffer` is the climber's separation from the water, measured
// in seconds: the water drains it at DRAIN/sec, each correct climb adds CLIMB,
// each wrong grab surges it down by WRONG. At buffer 0 the water covers the
// climber → game over. Tuned so a steady ~4s-per-word pace stays just ahead;
// dithering or repeated wrong grabs drowns you. Exposed here for easy tuning.
const START_BUFFER = 9;
const MAX_BUFFER = 14;           // cap so banking fast answers isn't invincible
const CLIMB_BOOST = 4.5;
const WRONG_PENALTY = 1.8;
const DRAIN_PER_SEC = 1;

// Water height as a % of the cliff field; mirrors the CSS layout. The climber's
// feet sit near DANGER%, so the water swallows the climber as buffer → 0.
const WATER_FLOOR = 7;           // water height at full buffer
const DANGER = 37;               // water height at buffer 0 (game over)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const waterPctFor = (buffer: number) =>
  WATER_FLOOR + (1 - clamp(buffer, 0, MAX_BUFFER) / MAX_BUFFER) * (DANGER - WATER_FLOOR);

interface HoldSpec { id: string; word: string; correct: boolean; }

// Module-level (Math.random outside render) so react-hooks/purity stays quiet
// and a re-render doesn't reshuffle the holds mid-round.
function makeHolds(correctWord: string, distractors: string[]): HoldSpec[] {
  const words = shuffle([
    { word: correctWord, correct: true },
    ...distractors.map((w) => ({ word: w, correct: false })),
  ]);
  return words.map((w, i) => ({ id: `h${i}-${w.word}`, word: w.word, correct: w.correct }));
}

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

export function ClimbToSafety({ rounds, pool, language, avatarId, audio = true, paused = false, onAnswer, onComplete }: Props) {
  const total = rounds.length;
  const [roundIndex, setRoundIndex] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // Map of `${roundIndex}:${holdId}` → how it resolved. Keying by round index
  // means past rounds' grabs are simply never looked up — no per-round reset.
  const [grabbed, setGrabbed] = useState<Record<string, 'correct' | 'wrong'>>({});
  const [climberFailed, setClimberFailed] = useState(false);

  const resolvedRef = useRef(false);   // current round settled (correct grab)
  const answeredRef = useRef(false);   // first grab graded to the API
  const advancingRef = useRef(false);  // in the celebrate gap between rounds
  const doneRef = useRef(false);       // whole lesson finished
  const gameOverRef = useRef(false);

  const bufferRef = useRef(START_BUFFER);
  const displayRef = useRef(START_BUFFER); // eased water value, for a smooth recede
  const lastTsRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  const waterRef = useRef<HTMLDivElement>(null);
  const climberRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const round = rounds[roundIndex];
  const mode: AnswerMode = round.promptKind === 'word' ? 'translation' : 'identification';
  const grabKey = (id: string) => `${roundIndex}:${id}`;

  const holds = useMemo(() => {
    const correctWord = rounds[roundIndex].target.english;
    const seen = new Set<string>([correctWord]);
    const distractorPool: string[] = [];
    for (const w of pool) {
      if (seen.has(w.english)) continue;
      seen.add(w.english);
      distractorPool.push(w.english);
    }
    return makeHolds(correctWord, pickN(distractorPool, HOLD_COUNT - 1));
  }, [rounds, roundIndex, pool]);

  // Reset the per-round flags whenever the round changes.
  useEffect(() => {
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
  }, [roundIndex]);

  // The rising-water loop. Runs for the component's lifetime: it drains the
  // buffer continuously (except while paused / advancing / over / done), eases
  // the displayed water toward it, writes the height imperatively (so the 60fps
  // updates never re-render the holds), and ends the game at buffer 0. rAF's
  // timestamp arg gives dt without Date.now().
  useEffect(() => {
    let raf = 0;
    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (last == null) return;
      const dt = Math.min(0.05, (ts - last) / 1000); // clamp big tab-switch gaps
      const live = !pausedRef.current && !advancingRef.current && !gameOverRef.current && !doneRef.current;
      if (live) bufferRef.current = clamp(bufferRef.current - dt * DRAIN_PER_SEC, -1, MAX_BUFFER);
      displayRef.current += (bufferRef.current - displayRef.current) * Math.min(1, dt * 10);
      if (waterRef.current) waterRef.current.style.height = `${waterPctFor(displayRef.current)}%`;
      if (live && bufferRef.current <= 0) {
        gameOverRef.current = true;
        setGameOver(true);
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  function advance() {
    if (roundIndex + 1 >= total) {
      doneRef.current = true;
      onComplete();
    } else {
      setRoundIndex((i) => i + 1);
    }
  }

  function grab(hold: HoldSpec, clientX: number, clientY: number) {
    if (resolvedRef.current || gameOverRef.current || grabbed[grabKey(hold.id)]) return;

    // Grade the first grab of the round (one answer submitted per word).
    if (!answeredRef.current) {
      onAnswer(round.target.senseId, hold.correct, mode);
      answeredRef.current = true;
    }

    if (hold.correct) {
      resolvedRef.current = true;
      advancingRef.current = true; // freeze the water through the celebrate gap
      bufferRef.current = clamp(bufferRef.current + CLIMB_BOOST, -1, MAX_BUFFER);
      setGrabbed((g) => ({ ...g, [grabKey(hold.id)]: 'correct' }));
      fireConfetti({ x: clientX / window.innerWidth, y: clientY / window.innerHeight });
      // Retrigger the climber's hop animation.
      const el = climberRef.current;
      if (el) { el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); }
      if (audio) {
        if (roundIndex + 1 < total) playCorrect(); // final round's victory trumpet covers it
        speakAvatar(hold.word, avatarId);
      }
      window.setTimeout(advance, ADVANCE_DELAY_MS);
    } else {
      // Wrong grab: the hold crumbles and the water surges; the round stays open
      // until the correct hold is grabbed.
      bufferRef.current = clamp(bufferRef.current - WRONG_PENALTY, -1, MAX_BUFFER);
      setGrabbed((g) => ({ ...g, [grabKey(hold.id)]: 'wrong' }));
    }
  }

  // Replay the whole climb from the first ledge. Answers already submitted this
  // run still counted server-side; re-answering simply re-scores those words.
  function retry() {
    bufferRef.current = START_BUFFER;
    displayRef.current = START_BUFFER;
    lastTsRef.current = null;
    gameOverRef.current = false;
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
    setGrabbed({});
    setGameOver(false);
    setRoundIndex(0);
  }

  const avatar = avatarById(avatarId);

  return (
    <div className="climb-game">
      <div className="climb-hud">
        <span className="climb-ledge">{t('climb.ledge', { n: roundIndex + 1, total })}</span>
        <p className="climb-instruction">{t('climb.instruction')}</p>
      </div>

      <div className="climb-prompt">
        {round.promptKind === 'image' ? (
          <div className="climb-prompt-card image">
            {imageUrl(round.target) && <img src={imageUrl(round.target)!} alt="" className="climb-prompt-img" />}
          </div>
        ) : (
          <div className="climb-prompt-card">
            <span className="climb-prompt-word">{nativeOf(round.target, language)}</span>
          </div>
        )}
      </div>

      <div className="climb-field">
        <div className="climb-holds">
          {holds.map((h) => {
            const state = grabbed[grabKey(h.id)];
            return (
              <button
                key={h.id}
                type="button"
                className={`climb-hold${state ? ` ${state}` : ''}`}
                disabled={!!state || gameOver}
                onClick={(e) => grab(h, e.clientX, e.clientY)}
              >
                {h.word}
              </button>
            );
          })}
        </div>

        <div className="climb-climber" ref={climberRef}>
          {climberFailed ? (
            <span className="climb-climber-emoji" role="img" aria-label="climber">🧗</span>
          ) : (
            <img src={avatar.imageUrl} alt="" onError={() => setClimberFailed(true)} draggable={false} />
          )}
        </div>

        <div className="climb-water" ref={waterRef} style={{ height: `${waterPctFor(START_BUFFER)}%` }} />

        {gameOver && (
          <div className="climb-over">
            <div className="climb-over-title">{t('climb.gameOver')}</div>
            <p className="climb-over-hint">{t('climb.gameOverHint')}</p>
            <button type="button" className="climb-retry-btn" onClick={retry}>{t('climb.retry')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
