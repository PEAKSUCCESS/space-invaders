import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { ChoiceKind, ClimbRound } from '../game/lesson';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { t } from '../i18n/i18n';

interface Props {
  rounds: ClimbRound[];
  pool: ApiWord[];                 // bin — source of distractor choices
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  paused?: boolean;                // freeze the rising water (e.g. feedback modal open)
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
}

const CHOICE_COUNT = 6;          // tiles per round (1 correct + distractors)
const ADVANCE_DELAY_MS = 750;    // celebrate the climb before the next round

// Ascent model (all in % of the scene height): the climber rises a fixed step per
// correct answer; the water only ever RISES — continuously over time, plus a surge
// on a wrong answer. Game over when the water reaches the climber's feet; clear all
// rounds to escape. Tuned so a steady pace stays ahead and dithering drowns you.
const CLIMBER_START = 8;
const CLIMB_STEP = 4.3;          // ~15 climbs → near CLIMBER_MAX
const CLIMBER_MAX = 72;          // clamp so the sprite never clips the top
const WATER_RISE_PER_SEC = 0.75;
const WRONG_SURGE = 3;
const FEET_MARGIN = 1;           // water within this % of the feet = caught

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// A back-view hiker climbing the ladder (cap + backpack facing us, hands gripping
// a rung overhead, boots on a rung) — mimics public/hiker.png's palette, no poles.
function HikerClimber() {
  return (
    <svg viewBox="0 0 90 112" className="climb-hiker" role="img" aria-label="climber">
      <g strokeLinecap="round" fill="none">
        <line x1="34" y1="45" x2="28" y2="30" stroke="#6f7d3f" strokeWidth="10" />
        <line x1="56" y1="45" x2="62" y2="30" stroke="#6f7d3f" strokeWidth="10" />
        <line x1="34" y1="44" x2="21" y2="13" stroke="#e7b58c" strokeWidth="8.5" />
        <line x1="56" y1="44" x2="69" y2="13" stroke="#e7b58c" strokeWidth="8.5" />
      </g>
      <circle cx="20" cy="12" r="5.5" fill="#d99b6c" />
      <circle cx="70" cy="12" r="5.5" fill="#d99b6c" />
      <path d="M35 30 a10 10 0 0 1 20 0 z" fill="#df7026" />
      <ellipse cx="45" cy="31" rx="8.5" ry="8.5" fill="#e9b78f" />
      <rect x="40" y="34" width="10" height="7" rx="3" fill="#caa074" />
      <rect x="27" y="34" width="36" height="42" rx="11" fill="#525d66" />
      <rect x="31" y="36" width="28" height="12" rx="6" fill="#414b54" />
      <line x1="35" y1="44" x2="40" y2="72" stroke="#39424a" strokeWidth="5" strokeLinecap="round" />
      <line x1="55" y1="44" x2="50" y2="72" stroke="#39424a" strokeWidth="5" strokeLinecap="round" />
      <g strokeLinecap="round" fill="none">
        <polyline points="40,72 35,87 41,96" stroke="#7a4f26" strokeWidth="11" />
        <line x1="51" y1="72" x2="55" y2="101" stroke="#7a4f26" strokeWidth="11" />
      </g>
      <ellipse cx="41" cy="98" rx="8" ry="4.5" fill="#5a3a1e" />
      <ellipse cx="56" cy="104" rx="8" ry="4.5" fill="#5a3a1e" />
    </svg>
  );
}

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

interface Choice { id: string; correct: boolean; label?: string; img?: string; }

// Module-level (Math.random outside render) so react-hooks/purity stays quiet and
// a re-render doesn't reshuffle the tiles mid-round. The correct choice is the
// target rendered in the choice modality; distractors are distinct pool words.
function buildChoices(target: ApiWord, choiceKind: ChoiceKind, pool: ApiWord[], language: LanguageCode): Choice[] {
  let correct: Choice;
  const distractors: Choice[] = [];
  if (choiceKind === 'image') {
    correct = { id: 'c', correct: true, img: imageUrl(target) ?? undefined };
    const seen = new Set<string>([target.senseId]);
    for (const w of pool) {
      if (seen.has(w.senseId) || !w.pictureUrl) continue;
      seen.add(w.senseId);
      distractors.push({ id: `d-${w.senseId}`, correct: false, img: imageUrl(w) ?? undefined });
    }
  } else if (choiceKind === 'nativeWord') {
    const tn = nativeOf(target, language) ?? target.english;
    correct = { id: 'c', correct: true, label: tn };
    const seen = new Set<string>([tn]);
    for (const w of pool) {
      const n = nativeOf(w, language);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      distractors.push({ id: `d-${w.senseId}`, correct: false, label: n });
    }
  } else {
    correct = { id: 'c', correct: true, label: target.english };
    const seen = new Set<string>([target.english]);
    for (const w of pool) {
      if (seen.has(w.english)) continue;
      seen.add(w.english);
      distractors.push({ id: `d-${w.senseId}`, correct: false, label: w.english });
    }
  }
  return shuffle([correct, ...pickN(distractors, CHOICE_COUNT - 1)]);
}

export function ClimbToSafety({ rounds, pool, language, avatarId, audio = true, paused = false, onAnswer, onComplete }: Props) {
  const total = rounds.length;
  const [roundIndex, setRoundIndex] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // Map of `${roundIndex}:${choiceId}` → how it resolved. Keying by round index
  // means past rounds' choices are simply never looked up — no per-round reset.
  const [chosen, setChosen] = useState<Record<string, 'correct' | 'wrong'>>({});
  // The climber's height up the scene (%); rises a step per correct answer (a CSS
  // transition animates the climb). Mirrored to a ref for the water-collision test.
  const [climberPos, setClimberPos] = useState(CLIMBER_START);

  const resolvedRef = useRef(false);   // current round settled (correct choice)
  const answeredRef = useRef(false);   // first choice graded to the API
  const advancingRef = useRef(false);  // in the celebrate gap between rounds
  const doneRef = useRef(false);       // whole lesson finished
  const gameOverRef = useRef(false);

  const climberPosRef = useRef(CLIMBER_START);
  const waterPosRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  const waterRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const round = rounds[roundIndex];
  // An image on either side → identification; native↔English → translation.
  const mode: AnswerMode = round.clueKind === 'image' || round.choiceKind === 'image' ? 'identification' : 'translation';
  const choiceKey = (id: string) => `${roundIndex}:${id}`;

  const choices = useMemo(
    () => buildChoices(rounds[roundIndex].target, rounds[roundIndex].choiceKind, pool, language),
    [rounds, roundIndex, pool, language],
  );

  // Reset the per-round flags whenever the round changes.
  useEffect(() => {
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
  }, [roundIndex]);

  // The rising-water loop. The water only ever rises — continuously while live —
  // and its height is written imperatively (no per-frame re-render of the tiles).
  // Game over when it reaches the climber's feet. rAF's timestamp gives dt.
  useEffect(() => {
    let raf = 0;
    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (last == null) return;
      const dt = Math.min(0.05, (ts - last) / 1000); // clamp big tab-switch gaps
      const live = !pausedRef.current && !advancingRef.current && !gameOverRef.current && !doneRef.current;
      if (live) waterPosRef.current = clamp(waterPosRef.current + dt * WATER_RISE_PER_SEC, 0, 100);
      if (waterRef.current) waterRef.current.style.height = `${waterPosRef.current}%`;
      if (live && waterPosRef.current >= climberPosRef.current - FEET_MARGIN) {
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

  function choose(choice: Choice, clientX: number, clientY: number) {
    if (resolvedRef.current || gameOverRef.current || chosen[choiceKey(choice.id)]) return;

    // Grade the first choice of the round (one answer submitted per word).
    if (!answeredRef.current) {
      onAnswer(round.target.senseId, choice.correct, mode);
      answeredRef.current = true;
    }

    if (choice.correct) {
      resolvedRef.current = true;
      advancingRef.current = true; // brief breather while the climber rises + we advance
      const next = clamp(climberPosRef.current + CLIMB_STEP, CLIMBER_START, CLIMBER_MAX);
      climberPosRef.current = next;
      setClimberPos(next);
      setChosen((c) => ({ ...c, [choiceKey(choice.id)]: 'correct' }));
      fireConfetti({ x: clientX / window.innerWidth, y: clientY / window.innerHeight });
      if (audio) {
        if (roundIndex + 1 < total) playCorrect(); // final round's victory trumpet covers it
        speakAvatar(round.target.english, avatarId);
      }
      window.setTimeout(advance, ADVANCE_DELAY_MS);
    } else {
      // Wrong: the water surges up (it never recedes); the round stays open until
      // the correct choice is picked.
      waterPosRef.current = clamp(waterPosRef.current + WRONG_SURGE, 0, 100);
      setChosen((c) => ({ ...c, [choiceKey(choice.id)]: 'wrong' }));
    }
  }

  // Replay the whole climb from the bottom. Answers already submitted this run
  // still counted server-side; re-answering simply re-scores those words.
  function retry() {
    waterPosRef.current = 0;
    climberPosRef.current = CLIMBER_START;
    lastTsRef.current = null;
    gameOverRef.current = false;
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
    setChosen({});
    setGameOver(false);
    setClimberPos(CLIMBER_START);
    setRoundIndex(0);
  }

  function renderClue() {
    if (round.clueKind === 'image') {
      const src = imageUrl(round.target);
      return <div className="climb-clue-card image">{src && <img src={src} alt="" className="climb-clue-img" />}</div>;
    }
    const word = round.clueKind === 'nativeWord' ? nativeOf(round.target, language) : round.target.english;
    return <div className="climb-clue-card"><span className="climb-clue-word">{word}</span></div>;
  }

  return (
    <div className="climb-game">
      <div className="climb-hud">
        <span className="climb-ledge">{t('climb.ledge', { n: roundIndex + 1, total })}</span>
        <p className="climb-instruction">{t('climb.instruction')}</p>
      </div>

      {/* Clue at the top … */}
      <div className="climb-clue">{renderClue()}</div>

      {/* … the choices just below it, above the ladder. */}
      <div className="climb-choices">
        {choices.map((c) => {
          const state = chosen[choiceKey(c.id)];
          return (
            <button
              key={c.id}
              type="button"
              className={`climb-choice${c.img ? ' image' : ''}${state ? ` ${state}` : ''}`}
              disabled={!!state || gameOver}
              onClick={(e) => choose(c, e.clientX, e.clientY)}
            >
              {c.img ? <img src={c.img} alt="" /> : c.label}
            </button>
          );
        })}
      </div>

      {/* The climb scene: ladder, hiker ascending, ever-rising water. */}
      <div className="climb-scene">
        <div className="climb-ladder" aria-hidden="true" />

        <div className="climb-climber" style={{ bottom: `${climberPos}%` }}>
          <HikerClimber />
        </div>

        <div className="climb-water" ref={waterRef} style={{ height: '0%' }}>
          <svg className="climb-wave back" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 12 q 25 -12 50 0 t 50 0 t 50 0 t 50 0 V20 H0 Z" />
          </svg>
          <svg className="climb-wave front" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 10 q 25 -10 50 0 t 50 0 t 50 0 t 50 0 V20 H0 Z" />
          </svg>
        </div>

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
