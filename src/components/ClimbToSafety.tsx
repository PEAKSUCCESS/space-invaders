import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { ChoiceKind, ClimbRound } from '../game/lesson';
import type { GameConfig } from '../lib/gameConfig';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { fireConfetti } from './effects/Confetti';
import { playCorrect } from '../lib/sound';
import { CountdownDial } from './CountdownDial';
import { t } from '../i18n/i18n';

interface Props {
  rounds: ClimbRound[];
  pool: ApiWord[];                 // bin — source of distractor choices
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  paused?: boolean;                // freeze the rising water (e.g. feedback modal open)
  config?: GameConfig;             // runtime difficulty tuning (water rise, etc.)
  pineappleChance?: number;        // 0–1 spawn odds for the hidden pineapple (usage-driven)
  startTime?: number;              // game start timestamp (for the countdown dial)
  targetMs?: number;               // dial target — the leaderboard best or the par time
  targetLabel?: string;            // 'best' | 'par'
  onRetry?: () => void;            // "Try again" after drowning — restart the run timer
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
  onPineappleFound?: () => void;   // fired once per find — App credits the token award
}

const CHOICE_COUNT = 4;          // tiles per round (1 correct + distractors)
const ADVANCE_DELAY_MS = 500;    // celebrate the climb before the next round

// Ascent model (all in % of the scene height): the climber rises a fixed step per
// correct answer; the water only ever RISES — continuously over time, plus a surge
// on a wrong answer. Game over when the water reaches the climber's feet; clear all
// rounds to escape. Tuned so a steady pace stays ahead and dithering drowns you.
const CLIMBER_START = 8;
const CLIMB_STEP = 4.3;          // ~15 climbs → near CLIMBER_MAX
const CLIMBER_MAX = 70;          // clamp so the sprite never clips the top
const WATER_RISE_PER_SEC = 0.9; // 20% faster than the original 0.75
const WRONG_SURGE = 3;
// The climber is "covered" (game over) only when the water reaches the top of the
// head — ~78px above the sprite's bottom anchor (≈0.82 × the 95px climber height in
// index.css), converted to a % of the live scene height each frame.
const CLIMBER_HEAD_PX = 78;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Hidden-pineapple easter egg: at most one per game, at a random spot in the
// ocean (depth is a % of the water body, like the fish, so it surfaces as the
// water rises). Clicking it pauses the game and pops the YIPEE card; it never
// respawns within the same game (not even after "Try again"). The spawn
// probability comes from the shopper's 14-day active usage (pineappleChance
// prop, resolved in App via lib/activityTime).
// Module-level (Math.random outside render, same convention as coinFlip/buildChoices).
function rollPineapple(chance: number): { left: number; bottom: number } | null {
  if (Math.random() >= chance) return null;
  return { left: 6 + Math.random() * 78, bottom: 8 + Math.random() * 60 };
}

function Pineapple() {
  return (
    <svg viewBox="0 0 40 62" className="pineapple-svg" aria-hidden="true">
      {/* crown of leaves */}
      <g fill="#3d9e4c">
        <path d="M20 22 L7 8 L17 16 Z" fill="#2f8a3e" />
        <path d="M20 22 L33 8 L23 16 Z" fill="#2f8a3e" />
        <path d="M20 22 L12 2 L19 13 Z" />
        <path d="M20 22 L28 2 L21 13 Z" />
        <path d="M20 22 L20 0 L22.5 12 Z" fill="#2f8a3e" />
      </g>
      {/* body + crosshatch skin */}
      <ellipse cx="20" cy="40" rx="14" ry="19" fill="#f0a83a" />
      <g stroke="#c9822a" strokeWidth="1.4" opacity="0.85" fill="none">
        <path d="M9 28 L33 48" /><path d="M7 36 L31 55" /><path d="M8 45 L26 58" /><path d="M13 23 L34 40" />
        <path d="M31 28 L7 48" /><path d="M33 36 L9 55" /><path d="M32 45 L14 58" /><path d="M27 23 L6 40" />
      </g>
    </svg>
  );
}

// A slim back-view hiker climbing the ladder (cap + ponytail + small green pack
// facing us, hands gripping a rung overhead, boots planted on a rung) — mimics
// public/hiker.png's palette (olive shirt/skin, orange cap, brown pants), no poles.
function HikerClimber() {
  return (
    <svg viewBox="0 0 80 122" className="climb-hiker" role="img" aria-label="climber">
      {/* legs */}
      <g strokeLinecap="round" fill="none">
        <line x1="36" y1="64" x2="35" y2="101" stroke="#845424" strokeWidth="7" />
        <line x1="44" y1="64" x2="46" y2="101" stroke="#845424" strokeWidth="7" />
      </g>
      {/* boots, flat on a rung */}
      <rect x="28" y="100" width="13" height="7.5" rx="3" fill="#483024" />
      <rect x="40" y="100" width="13" height="7.5" rx="3" fill="#483024" />
      {/* arms (olive sleeve + olive-tan forearm) reaching up */}
      <g strokeLinecap="round" fill="none">
        <line x1="34" y1="47" x2="26" y2="17" stroke="#786c3c" strokeWidth="7.5" />
        <line x1="46" y1="47" x2="54" y2="17" stroke="#786c3c" strokeWidth="7.5" />
        <line x1="30" y1="30" x2="25" y2="16" stroke="#cba06a" strokeWidth="6.2" />
        <line x1="50" y1="30" x2="55" y2="16" stroke="#cba06a" strokeWidth="6.2" />
      </g>
      {/* torso + small green daypack with straps */}
      <rect x="32.5" y="42" width="15" height="25" rx="7" fill="#786c3c" />
      <rect x="33.5" y="45" width="13" height="16" rx="5" fill="#5f6e39" />
      <rect x="35.2" y="46.5" width="9.6" height="5.5" rx="2.5" fill="#4a5a2b" />
      <path d="M34.5 47 q3 6 3.5 12" stroke="#3f4a26" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M45.5 47 q-3 6 -3.5 12" stroke="#3f4a26" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* hair on the back of the head + ponytail (matching brown), cap on top */}
      <path d="M40 33 c -3.8 4 -4.4 12 -1.8 19 c 3 -3 3.8 -12 1.8 -19 z" fill="#5e4127" />
      <ellipse cx="40" cy="34" rx="7.4" ry="7.6" fill="#5e4127" />
      <ellipse cx="40" cy="28.8" rx="9.2" ry="7" fill="#d87830" />
      <rect x="32.8" y="29" width="14.4" height="4" rx="2" fill="#bf6722" />
      {/* hands gripping the rung, fingers curling over */}
      <ellipse cx="25" cy="15" rx="5.8" ry="4.6" fill="#cba06a" />
      <ellipse cx="55" cy="15" rx="5.8" ry="4.6" fill="#cba06a" />
      <g stroke="#a9844e" strokeWidth="1.5" strokeLinecap="round">
        <line x1="22.2" y1="16" x2="22.2" y2="20" /><line x1="25" y1="16.7" x2="25" y2="20.8" /><line x1="27.8" y1="16" x2="27.8" y2="20" />
        <line x1="52.2" y1="16" x2="52.2" y2="20" /><line x1="55" y1="16.7" x2="55" y2="20.8" /><line x1="57.8" y1="16" x2="57.8" y2="20" />
      </g>
    </svg>
  );
}

function Fish({ body, tail }: { body: string; tail: string }) {
  return (
    <svg viewBox="0 0 28 16" width="32" height="18">
      <path d="M8 8 L0 2 L0 14 Z" fill={tail} />
      <ellipse cx="16" cy="8" rx="9" ry="5.2" fill={body} />
      <circle cx="21" cy="6.3" r="1.1" fill="#16242c" />
    </svg>
  );
}

// A seagull in side profile facing the way it flies (head + beak forward, tail
// back, one flapping wing) — so its orientation matches its horizontal travel.
// White body with grey wing/tail and a slate outline for contrast on the sky;
// leftward gulls are flipped via CSS. The wing flaps about its base.
function Seagull() {
  return (
    <svg viewBox="0 0 52 32" className="gull-svg" aria-hidden="true">
      {/* tail (back), slightly forked */}
      <path d="M11 21 L2 18.5 L5 21 L1.5 23.5 L11 23 Z" fill="#9aa9b4" stroke="#52616c" strokeWidth="0.9" strokeLinejoin="round" />
      {/* body + head */}
      <path d="M8 22 Q5.5 20 9.5 19 L20 18 Q31 17.4 40 19.4 Q45 20.4 45 22 Q43 24 39 24 Q28 24.8 18 24 Q11.5 24 8 22 Z" fill="#fdfeff" stroke="#52616c" strokeWidth="1.1" strokeLinejoin="round" />
      {/* beak (points in the direction of travel) */}
      <path d="M44.5 20.4 l5.2 0.9 -4.8 1.9 Z" fill="#f2a13a" stroke="#cf8526" strokeWidth="0.5" strokeLinejoin="round" />
      {/* eye */}
      <circle cx="42" cy="20.6" r="0.95" fill="#27323a" />
      {/* flapping wing */}
      <path className="gull-wing" d="M26 20.2 Q19 7 7 8.5 Q17 14.5 24 21 Z" fill="#9aa9b4" stroke="#52616c" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

// A translucent floating jellyfish — a scalloped bell with a highlight and four
// trailing tentacles. The bell pulses and the tentacles sway via CSS.
function Jellyfish() {
  return (
    <svg viewBox="0 0 36 58" className="jelly-svg" aria-hidden="true">
      <g className="jelly-arms" stroke="#c98fd6" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.8">
        <path d="M10 26 q -2 8 1 15 q 2 6 -1 13" />
        <path d="M15 27 q -1 9 1 16 q 1 7 -1 12" />
        <path d="M21 27 q 1 9 -1 16 q -1 7 1 12" />
        <path d="M26 26 q 2 8 -1 15 q -2 6 1 13" />
      </g>
      <g className="jelly-bell">
        <path d="M5 20 Q5 5 18 5 Q31 5 31 20 Q31 23 29 25 Q26 22 23 25 Q20 22 18 25 Q15 22 12.5 25 Q9 22 7 25 Q5 23 5 20 Z" fill="#d39ce0" opacity="0.72" />
        <path d="M10 9 Q14 6 19 8" stroke="#fbf1ff" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
      </g>
    </svg>
  );
}

// A leaping dolphin (nose up-right) — body, belly highlight, dorsal + pectoral
// fins and tail flukes. The arc + nose-up→nose-down rotation come from CSS.
function Dolphin() {
  return (
    <svg viewBox="0 0 96 80" className="dolphin-svg" aria-hidden="true">
      <path d="M18 58 Q3 52 7 64 Q12 57 19 60 Z" fill="#5a83a3" />
      <path d="M40 46 Q31 57 25 53 Q35 47 40 46 Z" fill="#5a83a3" />
      <path d="M18 58 C 20 32 40 12 78 8 C 67 19 59 30 54 42 C 49 52 38 58 18 58 Z" fill="#6a93b0" />
      <path d="M26 53 C 30 35 46 19 70 12 C 61 22 55 32 50 43 C 46 50 37 55 26 53 Z" fill="#d4e6f0" opacity="0.75" />
      <path d="M44 19 Q50 5 59 15 Q50 16 47 24 Z" fill="#5a83a3" />
      <circle cx="68" cy="17" r="1.9" fill="#1b2a33" />
    </svg>
  );
}

// A cute octopus resting on the seafloor — domed mantle, two big eyes, and a
// fan of eight arms that sway gently (the arm group skews via CSS).
function Octopus() {
  return (
    <svg viewBox="0 0 64 64" className="octo-svg" aria-hidden="true">
      <g className="octo-arms" stroke="#bf4a7e" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M14 37 Q4 47 8 59" />
        <path d="M19 41 Q12 51 15 62" />
        <path d="M25 43 Q21 54 24 63" />
        <path d="M31 44 Q30 56 32 64" />
        <path d="M37 43 Q40 54 38 63" />
        <path d="M43 43 Q47 54 43 63" />
        <path d="M49 41 Q56 51 52 62" />
        <path d="M53 37 Q62 47 58 59" />
      </g>
      <path d="M12 30 Q12 7 33 7 Q54 7 54 30 Q54 40 46 44 L20 44 Q12 40 12 30 Z" fill="#d2568a" />
      <ellipse cx="26" cy="27" rx="5.2" ry="6.2" fill="#fff" />
      <ellipse cx="40" cy="27" rx="5.2" ry="6.2" fill="#fff" />
      <circle cx="27" cy="28.5" r="2.6" fill="#33122b" />
      <circle cx="41" cy="28.5" r="2.6" fill="#33122b" />
      <ellipse cx="20" cy="35" rx="3" ry="2" fill="#e98bb0" opacity="0.7" />
      <ellipse cx="46" cy="35" rx="3" ry="2" fill="#e98bb0" opacity="0.7" />
    </svg>
  );
}

// Decorative marine life drifting in the water — a whale, a shark, fish, and
// swaying seaweed. Clipped to the water body, so they surface as the water rises.
function SeaLife() {
  return (
    <div className="climb-sealife" aria-hidden="true">
      <span className="sea whale">
        <svg viewBox="0 0 96 46" width="120" height="57">
          <path d="M92 22 Q70 8 40 14 Q16 18 6 12 Q2 14 4 20 Q1 24 5 30 Q12 27 22 28 Q14 33 18 38 Q26 34 34 33 Q64 38 92 26 Q96 24 92 22 Z" fill="#2f5d88" />
          <path d="M40 30 Q60 36 86 27 Q66 33 40 30 Z" fill="#9cc0dd" opacity="0.5" />
          <circle cx="84" cy="20" r="1.6" fill="#0d1f2e" />
        </svg>
      </span>
      <span className="sea shark">
        {/* viewBox opened above the body so the dorsal fin has headroom */}
        <svg viewBox="0 -10 64 40" width="82" height="51">
          {/* body */}
          <path d="M61 14 Q44 7 26 11 L5 5 Q10 14 5 23 L26 17 Q44 21 61 14 Z" fill="#90a7b5" />
          {/* big swept-back dorsal fin */}
          <path d="M24 9 L41 8 L26 -8 Z" fill="#7d94a2" />
          {/* pectoral fin (underside) */}
          <path d="M30 17 L26 24 L37 18 Z" fill="#7d94a2" />
          {/* open, toothy mouth: dark gap + upper & lower rows of teeth */}
          <path d="M46 14.5 Q53 15 61 14 L60 18.5 Q53 20.5 47 18 Z" fill="#2b3a42" />
          <g fill="#ffffff">
            <path d="M47.5 14.8 l2.3 0 -1.15 3 Z" />
            <path d="M51 14.9 l2.3 0 -1.15 3 Z" />
            <path d="M54.5 14.7 l2.3 0 -1.15 2.9 Z" />
            <path d="M57.8 14.4 l2.1 0 -1.05 2.6 Z" />
          </g>
          <g fill="#f1f5f7">
            <path d="M48.5 18.2 l2.1 0 -1.05 -2.6 Z" />
            <path d="M52 18.4 l2.1 0 -1.05 -2.6 Z" />
            <path d="M55.5 18.1 l2 0 -1 -2.4 Z" />
          </g>
          {/* eye */}
          <circle cx="51" cy="11.5" r="1.4" fill="#10212c" />
          {/* gills */}
          <g stroke="#7d94a2" strokeWidth="1"><line x1="41" y1="9" x2="40" y2="16" /><line x1="44" y1="9" x2="43" y2="16" /></g>
        </svg>
      </span>
      <span className="sea fish f1"><Fish body="#f59c3f" tail="#ef8a3a" /></span>
      <span className="sea fish f2"><Fish body="#f0cf4d" tail="#e7c13a" /></span>
      <span className="sea fish f3"><Fish body="#f08a4a" tail="#e8743a" /></span>
      <span className="sea fish f4"><Fish body="#ef7d7d" tail="#d95a5a" /></span>
      <span className="sea fish f5"><Fish body="#6fc6c0" tail="#54b3ad" /></span>
      <span className="sea fish f6"><Fish body="#f6b24a" tail="#e89a33" /></span>
      <span className="octo"><Octopus /></span>
      <span className="jelly j1"><Jellyfish /></span>
      <span className="jelly j2"><Jellyfish /></span>
      <span className="jelly j3"><Jellyfish /></span>
      <span className="weed w1"><svg viewBox="0 0 20 80" width="22" height="84"><path d="M10 80 C4 64 16 54 9 40 C3 28 15 18 9 2" fill="none" stroke="#2f7d3f" strokeWidth="5.5" strokeLinecap="round" /><path d="M9 44 C15 40 18 45 17 52" fill="none" stroke="#2f7d3f" strokeWidth="3.5" strokeLinecap="round" /></svg></span>
      <span className="weed w2"><svg viewBox="0 0 20 64" width="20" height="68"><path d="M10 64 C16 50 4 42 11 30 C16 20 6 12 11 2" fill="none" stroke="#368a46" strokeWidth="5" strokeLinecap="round" /></svg></span>
      <span className="weed w3"><svg viewBox="0 0 20 90" width="22" height="94"><path d="M10 90 C3 72 17 60 9 44 C2 30 16 20 10 2" fill="none" stroke="#2a7038" strokeWidth="6" strokeLinecap="round" /><path d="M10 50 C3 46 1 52 3 58" fill="none" stroke="#2a7038" strokeWidth="3.5" strokeLinecap="round" /></svg></span>
      <span className="weed w4"><svg viewBox="0 0 20 54" width="20" height="58"><path d="M10 54 C15 42 5 34 11 22 C15 14 7 8 11 2" fill="none" stroke="#37934a" strokeWidth="4.5" strokeLinecap="round" /></svg></span>
    </div>
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

export function ClimbToSafety({ rounds, pool, language, avatarId, audio = true, paused = false, config, pineappleChance = 0.1, startTime, targetMs, targetLabel, onRetry, onAnswer, onComplete, onPineappleFound }: Props) {
  const total = rounds.length;
  const [roundIndex, setRoundIndex] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // Map of `${roundIndex}:${choiceId}` → how it resolved. Keying by round index
  // means past rounds' choices are simply never looked up — no per-round reset.
  const [chosen, setChosen] = useState<Record<string, 'correct' | 'wrong'>>({});
  // The climber's height up the scene (%); rises a step per correct answer (a CSS
  // transition animates the climb). Mirrored to a ref for the water-collision test.
  const [climberPos, setClimberPos] = useState(CLIMBER_START);
  // Hidden pineapple: rolled once per game (survives retries — at most one find).
  const [pineapple] = useState(() => rollPineapple(pineappleChance));
  const [pineappleFound, setPineappleFound] = useState(false);
  const [yipeeOpen, setYipeeOpen] = useState(false);

  const resolvedRef = useRef(false);   // current round settled (correct choice)
  const answeredRef = useRef(false);   // first choice graded to the API
  const advancingRef = useRef(false);  // in the celebrate gap between rounds
  const doneRef = useRef(false);       // whole lesson finished
  const gameOverRef = useRef(false);

  const climberPosRef = useRef(CLIMBER_START);
  const waterPosRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  const yipeeRef = useRef(false); // freeze the water while the YIPEE card is up
  const waterRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneHRef = useRef(0); // cached scene pixel height (for the head-coverage test)
  const riseRef = useRef(config?.waterRisePerSec ?? WATER_RISE_PER_SEC); // live water speed

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { riseRef.current = config?.waterRisePerSec ?? WATER_RISE_PER_SEC; }, [config]);

  // Cache the scene's pixel height so the head-coverage test stays accurate across
  // screen sizes without reading layout every frame.
  useEffect(() => {
    const measure = () => { if (sceneRef.current) sceneHRef.current = sceneRef.current.offsetHeight; };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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
      const live = !pausedRef.current && !yipeeRef.current && !advancingRef.current && !gameOverRef.current && !doneRef.current;
      if (live) waterPosRef.current = clamp(waterPosRef.current + dt * riseRef.current, 0, 100);
      if (waterRef.current) waterRef.current.style.height = `${waterPosRef.current}%`;
      // Game over only when the water rises above the climber's head (covered).
      const headPct = climberPosRef.current + (CLIMBER_HEAD_PX / (sceneHRef.current || 320)) * 100;
      if (live && waterPosRef.current >= headPct) {
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
      const next = clamp(climberPosRef.current + (config?.climbStep ?? CLIMB_STEP), CLIMBER_START, CLIMBER_MAX);
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
      waterPosRef.current = clamp(waterPosRef.current + (config?.wrongSurge ?? WRONG_SURGE), 0, 100);
      setChosen((c) => ({ ...c, [choiceKey(choice.id)]: 'wrong' }));
    }
  }

  function foundPineapple() {
    if (pineappleFound) return;
    setPineappleFound(true); // gone for the rest of the game
    yipeeRef.current = true; // stop the water while the card is up
    setYipeeOpen(true);
    onPineappleFound?.(); // App credits the token award (fire-and-forget)
  }

  function closeYipee() {
    yipeeRef.current = false;
    setYipeeOpen(false);
  }

  // Replay the whole climb from the bottom. Answers already submitted this run
  // still counted server-side; re-answering simply re-scores those words.
  function retry() {
    onRetry?.(); // restart the run clock so the time measures only this attempt
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
      <div className="climb-scene" ref={sceneRef}>
        {/* Seagulls gliding across the sky, behind the climber and water. */}
        <div className="climb-sky" aria-hidden="true">
          <span className="gull g1"><Seagull /></span>
          <span className="gull g2"><Seagull /></span>
          <span className="gull g3"><Seagull /></span>
        </div>

        <div className="climb-ladder" aria-hidden="true" />

        {typeof startTime === 'number' && typeof targetMs === 'number' && targetMs > 0 && (
          <CountdownDial startTime={startTime} targetMs={targetMs} label={targetLabel} />
        )}

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
          <SeaLife />
          {/* The hidden pineapple — clipped to the water body like the sea life
              (its own wrapper, since .climb-sealife kills pointer events), so it
              stays hidden until the rising water reveals it. */}
          {pineapple && !pineappleFound && (
            <div className="climb-pineapple-clip" aria-hidden="true">
              <button
                type="button"
                className="climb-pineapple"
                style={{ left: `${pineapple.left}%`, bottom: `${pineapple.bottom}%` }}
                tabIndex={-1}
                onClick={foundPineapple}
              >
                <Pineapple />
              </button>
            </div>
          )}
          {/* A dolphin that occasionally leaps from the (rising) water surface. */}
          <div className="climb-dolphin" aria-hidden="true"><Dolphin /></div>
        </div>

        {gameOver && (
          <div className="climb-over">
            <div className="climb-over-title">{t('climb.gameOver')}</div>
            <p className="climb-over-hint">{t('climb.gameOverHint')}</p>
            <button type="button" className="climb-retry-btn" onClick={retry}>{t('climb.retry')}</button>
          </div>
        )}
      </div>

      {/* Found-the-pineapple celebration — freezes the game until OK. */}
      {yipeeOpen && (
        <div className="yipee-overlay">
          <div className="yipee-card">
            <div className="yipee-title">YIPEE</div>
            <p className="yipee-msg">{t('pineapple.found')}</p>
            <button type="button" className="yipee-ok-btn" onClick={closeYipee}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
