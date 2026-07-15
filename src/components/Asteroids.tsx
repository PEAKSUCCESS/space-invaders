import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { ChoiceKind, ClimbRound } from '../game/lesson';
import type { GameConfig } from '../lib/gameConfig';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { playCorrect } from '../lib/sound';
import { CountdownDial } from './CountdownDial';
import { t } from '../i18n/i18n';

interface Props {
  rounds: ClimbRound[];
  pool: ApiWord[];                 // bin — source of distractor choices
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  paused?: boolean;                // freeze the drifting rocks (e.g. feedback modal open)
  config?: GameConfig;             // runtime difficulty tuning (drift speed, etc.)
  pineappleChance?: number;        // 0–1 spawn odds for the hidden pineapple (usage-driven)
  startTime?: number;              // game start timestamp (for the countdown dial)
  targetMs?: number;               // dial target — the leaderboard best or the par time
  targetLabel?: string;            // 'best' | 'par'
  onRetry?: () => void;            // "Try again" after the ship blows — restart the run timer
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onComplete: () => void;
  onPineappleFound?: () => void;   // fired once per find — App credits the token award
}

const CHOICE_COUNT = 4;          // asteroids per wave (1 correct + distractors)
const ADVANCE_DELAY_MS = 900;    // watch the debris scatter before the next wave

// Threat model: asteroids close in on the ship at the CENTRE of the screen from
// all directions; shooting the correct one clears the wave, a wrong shot turns
// that rock GLOWING HOT (faster, hits twice as hard). A rock that reaches the
// ship rams it — hull damage — and is flung radially away to come around again.
// Hull 0 → ship destroyed; clear all waves to survive. The config's
// waterRisePerSec doubles as the speed knob here (scaled against its own
// default) so the same runtime config tunes both games.
const MAX_HULL = 100;
const HIT_DAMAGE = 15;           // normal asteroid ramming the ship
const HOT_DAMAGE = 30;           // a glowing-hot rock hits twice as hard
const HOT_SPEED_MULT = 1.9;      // …and closes in almost twice as fast
const DRIFT_PER_SEC = 2.6;       // baseline closing speed (%/sec) — 25% up from the bottom-ship build
const BASE_RISE = 0.9;           // gameConfig.waterRisePerSec default → speed scale of 1
const KNOCKBACK_PCT = 34;        // how far (%) a rock is flung away after ramming the ship
const HOMING_ACCEL = 8;          // %/s² — how hard a rock steers back onto the ship
const BULLET_MS = 150;           // bullet flight time; the shot resolves on impact
const SHIP_X = 50;               // ship centre, % of scene width
const SHIP_Y = 50;               // ship centre, % of scene height — dead centre
const SHIP_RADIUS_PX = 30;       // collision radius around the ship centre
const SHARD_COUNT = 8;           // mini-asteroid shards per destroyed rock
const DECOY_COUNT = 3;           // unlabeled rocks per wave — shootable space junk
const DECOY_HEAL = 5;            // hull repaired by blasting a decoy rock
const ROCKET_HEAL = 10;          // hull repaired by shooting down a rocket

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Rock sizing, smaller on phones so 4 word/picture rocks fit a narrow scene.
const isSmallScreen = () => typeof window !== 'undefined' && window.innerWidth <= 520;

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

// Static per-wave asteroid data; live position/velocity is mutated in a kin map
// (a ref) and written to the DOM imperatively, so drifting never re-renders.
interface RockDef {
  id: string;
  correct: boolean;
  decoy?: boolean;   // unlabeled rock — shootable, never graded, never the answer
  label?: string;
  img?: string;
  sizePx: number;      // button diameter (also the collision size)
  points: string;      // jagged polygon for the 100×100 viewBox
  spinDur: number;     // seconds per revolution
  reverse: boolean;    // spin direction
  x0: number; y0: number;    // spawn centre, % of scene
  vx0: number; vy0: number;  // velocity, %/sec
  spd: number;               // this rock's cruising speed, %/sec
}
interface Kin { x: number; y: number; vx: number; vy: number; spd: number; rPx: number; decoy?: boolean; }

// A destroyed rock's shards — small jagged asteroids flung outward, drifting off.
interface Shard { id: number; x: number; y: number; dx: number; dy: number; dur: number; size: number; points: string; }

// A classic Atari-style jagged rock outline: n vertices at randomised radii.
function makeRockPoints(n = 11): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 34 + Math.random() * 14;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Module-level (Math.random outside render, same convention as buildChoices in
// ClimbToSafety). The correct choice is the target rendered in the wave's choice
// modality; distractors are distinct pool words. Each choice becomes an asteroid
// spawned on its own edge of the screen (all four sides), closing on the ship.
function buildRocks(
  target: ApiWord, choiceKind: ChoiceKind, pool: ApiWord[], language: LanguageCode, keyPrefix: string,
): RockDef[] {
  interface Choice { id: string; correct: boolean; label?: string; img?: string; }
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
  const choices = shuffle([correct, ...pickN(distractors, CHOICE_COUNT - 1)]);
  const sides = shuffle(['top', 'right', 'bottom', 'left']);
  // Spawn a rock on a screen edge, at a random spot along it, aimed at the ship.
  const spawn = (side: string, spd: number) => {
    const along = 12 + Math.random() * 76;
    const x0 = side === 'left' ? 7 : side === 'right' ? 93 : along;
    const y0 = side === 'top' ? 7 : side === 'bottom' ? 93 : along;
    const d = Math.hypot(SHIP_X - x0, SHIP_Y - y0) || 1;
    return { x0, y0, vx0: ((SHIP_X - x0) / d) * spd, vy0: ((SHIP_Y - y0) / d) * spd, spd };
  };
  const shape = () => ({
    points: makeRockPoints(),
    spinDur: 9 + Math.random() * 9, // slow, visible axis spin (one turn / 9–18s)
    reverse: Math.random() < 0.5,
  });
  const small = isSmallScreen();
  const labeled: RockDef[] = choices.map((c, i) => ({
    ...c,
    id: `${keyPrefix}:${c.id}`, // unique across waves/retries so DOM refs never collide
    sizePx: c.img ? (small ? 74 : 96) : (small ? 84 : 110),
    ...shape(),
    ...spawn(sides[i % sides.length], DRIFT_PER_SEC * (0.8 + Math.random() * 0.5)),
  }));
  // Plus a few unlabeled decoys — plain space rocks in varying sizes (always
  // smaller than the word/picture rocks) that can be shot for the fun of it.
  // Unlike the choices they DON'T home on the ship: each flies its own straight
  // line from its edge toward a random waypoint, which may or may not cross the
  // ship on any given pass (they wrap around the screen, so passes repeat).
  const decoys: RockDef[] = Array.from({ length: DECOY_COUNT }, (_, i): RockDef => {
    const side = sides[(choices.length + i) % sides.length];
    const along = 12 + Math.random() * 76;
    const x0 = side === 'left' ? 7 : side === 'right' ? 93 : along;
    const y0 = side === 'top' ? 7 : side === 'bottom' ? 93 : along;
    const tx = 15 + Math.random() * 70; // random waypoint, not the ship
    const ty = 15 + Math.random() * 70;
    const spd = DRIFT_PER_SEC * (0.7 + Math.random() * 0.6);
    const d = Math.hypot(tx - x0, ty - y0) || 1;
    return {
      id: `${keyPrefix}:x-${i}`,
      correct: false,
      decoy: true,
      sizePx: small ? 28 + Math.random() * 40 : 36 + Math.random() * 54,
      ...shape(),
      x0, y0,
      vx0: ((tx - x0) / d) * spd,
      vy0: ((ty - y0) / d) * spd,
      spd,
    };
  });
  return [...labeled, ...decoys];
}

let shardSeq = 0;
// The kill burst: the rock breaks into SHARD_COUNT small asteroids — each its
// own jagged outline — flung outward in a ring, floating off through space.
function makeShards(x: number, y: number, scale = 1): Shard[] {
  return Array.from({ length: SHARD_COUNT }, (_, i) => {
    const a = ((i + Math.random() * 0.7) / SHARD_COUNT) * Math.PI * 2; // spread round the ring
    const dist = 60 + Math.random() * 140;
    return {
      id: ++shardSeq,
      x, y,
      dx: Math.cos(a) * dist,
      dy: Math.sin(a) * dist,
      dur: 2.2 + Math.random() * 1.6,
      size: (12 + Math.random() * 12) * scale,
      points: makeRockPoints(7),
    };
  });
}

// Hidden-pineapple easter egg, adrift in deep space this time. Same contract as
// the climb game: rolled once per game, at most one find, spawn odds usage-driven.
function rollPineapple(chance: number): { left: number; top: number } | null {
  if (Math.random() >= chance) return null;
  return { left: 6 + Math.random() * 84, top: 26 + Math.random() * 42 };
}

// The pineapple, abducted: green-skinned, three black alien eyes, and a pair of
// glowing antennae — but still unmistakably a pineapple.
function AlienPineapple() {
  return (
    <svg viewBox="0 0 40 72" className="pineapple-svg alien" aria-hidden="true">
      {/* antennae with glowing orbs */}
      <g stroke="#7ef29a" strokeWidth="1.7" fill="none" strokeLinecap="round">
        <path d="M14 14 Q 9 8 7 4" />
        <path d="M26 14 Q 31 8 33 4" />
      </g>
      <circle cx="7" cy="4" r="2.6" fill="#b6ffc9" className="alien-orb" />
      <circle cx="33" cy="4" r="2.6" fill="#b6ffc9" className="alien-orb" />
      {/* crown of leaves */}
      <g fill="#3d9e4c" transform="translate(0 10)">
        <path d="M20 22 L7 8 L17 16 Z" fill="#2f8a3e" />
        <path d="M20 22 L33 8 L23 16 Z" fill="#2f8a3e" />
        <path d="M20 22 L12 2 L19 13 Z" />
        <path d="M20 22 L28 2 L21 13 Z" />
        <path d="M20 22 L20 0 L22.5 12 Z" fill="#2f8a3e" />
      </g>
      {/* body — little green pineapple + crosshatch skin */}
      <ellipse cx="20" cy="50" rx="14" ry="19" fill="#8fd94c" />
      <g stroke="#5da32e" strokeWidth="1.4" opacity="0.85" fill="none">
        <path d="M9 38 L33 58" /><path d="M7 46 L31 65" /><path d="M8 55 L26 68" /><path d="M13 33 L34 50" />
        <path d="M31 38 L7 58" /><path d="M33 46 L9 65" /><path d="M32 55 L14 68" /><path d="M27 33 L6 50" />
      </g>
      {/* three big alien eyes + a tiny mouth */}
      <ellipse cx="14" cy="46" rx="3.1" ry="4.5" fill="#0c2b12" />
      <ellipse cx="26" cy="46" rx="3.1" ry="4.5" fill="#0c2b12" />
      <ellipse cx="20" cy="52.5" rx="2.3" ry="3.3" fill="#0c2b12" />
      <circle cx="15" cy="44.4" r="0.9" fill="#d9ffe3" />
      <circle cx="27" cy="44.4" r="0.9" fill="#d9ffe3" />
      <circle cx="20.8" cy="51.2" r="0.7" fill="#d9ffe3" />
      <path d="M17 59 Q 20 61.5 23 59" stroke="#0c2b12" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Decorative flybys: the PeakESL cruiser gliding past now and then, and small
// rockets zipping through in random directions. Pure scenery — behind the rocks,
// no pointer events, no effect on play.
interface Flyby { id: number; kind: 'cruiser' | 'rocket' | 'star'; x: number; y: number; dxPx: number; dyPx: number; dur: number; deg: number; flip: boolean; }
let flybySeq = 0;

// The cruiser keeps ONE route: left → right through the upper quadrant, well
// clear of the player's ship at centre.
const CRUISER_LANE_Y = 14; // % from the top

function makeCruiser(w: number): Flyby {
  return {
    id: ++flybySeq,
    kind: 'cruiser',
    x: -14,
    y: CRUISER_LANE_Y,
    dxPx: 1.28 * w,
    dyPx: 0,
    dur: 11,
    deg: 0,
    flip: false,
  };
}

function makeRocket(w: number, h: number): Flyby {
  // Any direction: enter just outside a random edge, exit out the far side.
  const a = Math.random() * Math.PI * 2;
  const x1 = 50 + Math.cos(a) * 68;
  const y1 = 50 + Math.sin(a) * 68;
  const jig = (Math.random() - 0.5) * 50; // lateral offset so paths vary
  const x2 = 50 - Math.cos(a) * 68 + Math.sin(a) * jig;
  const y2 = 50 - Math.sin(a) * 68 - Math.cos(a) * jig;
  const dxPx = ((x2 - x1) / 100) * w;
  const dyPx = ((y2 - y1) / 100) * h;
  return {
    id: ++flybySeq,
    kind: 'rocket',
    x: x1, y: y1, dxPx, dyPx,
    dur: 3.25 + Math.random() * 3, // 20% slower than the first cut (duration ×1.25)
    deg: Math.atan2(dyPx, dxPx) * (180 / Math.PI),
    flip: false,
  };
}

// A shooting star: a small, bright streak that flashes across in under two
// seconds on a shallow random diagonal.
function makeStar(w: number, h: number): Flyby {
  const ltr = Math.random() < 0.5;
  const x1 = ltr ? -8 : 108;
  const y1 = 4 + Math.random() * 55;
  const y2 = y1 + 14 + Math.random() * 30; // always sloping gently downward
  const dxPx = ((ltr ? 116 : -116) / 100) * w;
  const dyPx = ((y2 - y1) / 100) * h;
  return {
    id: ++flybySeq,
    kind: 'star',
    x: x1, y: y1, dxPx, dyPx,
    dur: 1 + Math.random() * 0.8,
    deg: Math.atan2(dyPx, dxPx) * (180 / Math.PI),
    flip: false,
  };
}

// A long-haul cruiser in side profile — dome cockpit, twin engine glow, and the
// PeakESL logo across the hull. When the whole ship is mirrored for a
// right-to-left pass, the logo is counter-mirrored so the wordmark stays readable.
// With `slogan`, the hull instead carries the logo + "Speech is Power" line —
// used by the click popup (the same cruiser shape, larger).
function CruiserSvg({ flip = false, slogan = false }: { flip?: boolean; slogan?: boolean }) {
  return (
    <svg viewBox="0 0 180 60" className="ast-cruiser-svg" aria-hidden="true">
      {/* engine flames */}
      <polygon className="ast-flame" points="14,26 -2,30 14,34" fill="#ffa73a" stroke="#ffd9a0" strokeWidth="1" />
      <polygon className="ast-flame" points="16,38 4,41 16,44" fill="#ffa73a" stroke="#ffd9a0" strokeWidth="1" />
      {/* tail fin */}
      <path d="M18 30 L6 10 L34 22 Z" fill="#141b33" stroke="#9fb4cc" strokeWidth="2" strokeLinejoin="round" />
      {/* hull */}
      <path d="M14 30 Q 20 16 58 13 L 130 13 Q 168 17 176 30 Q 168 43 130 47 L 58 47 Q 20 44 14 30 Z"
        fill="#0e1430" stroke="#c9d8ea" strokeWidth="2.5" strokeLinejoin="round" />
      {/* cockpit dome */}
      <path d="M132 13 Q 145 1 160 12 Z" fill="#9fd8ff" stroke="#c9d8ea" strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
      {/* the PeakESL logo across the hull (white wordmark — made for dark hulls) */}
      {slogan ? (
        <>
          <image href="/peak_logo.png" x="56" y="16" width="80" height="14" />
          <text x="96" y="41" textAnchor="middle" fontSize="9.5" fontWeight="800" fontStyle="italic" fill="#ffd9a0" fontFamily="inherit">
            Speech is Power
          </text>
        </>
      ) : (
        <image href="/peak_logo.png" x="48" y="21" width="96" height="17" transform={flip ? 'scale(-1 1) translate(-192 0)' : undefined} />
      )}
      {/* running lights */}
      <circle cx="30" cy="30" r="1.8" fill="#7ef29a" className="alien-orb" />
      <circle cx="168" cy="30" r="1.8" fill="#ff8a5a" className="alien-orb" />
    </svg>
  );
}

// A small rocket drawn nose-right; the flyby wrapper rotates it to its heading.
function RocketSvg() {
  return (
    <svg viewBox="0 0 64 26" className="ast-rocket-svg" aria-hidden="true">
      <polygon className="ast-flame" points="12,13 -2,9 3,13 -2,17" fill="#ffa73a" stroke="#ffd9a0" strokeWidth="0.8" />
      {/* fins */}
      <path d="M14 13 L8 3 L24 9 Z" fill="#c34a4a" stroke="#802f2f" strokeWidth="1" strokeLinejoin="round" />
      <path d="M14 13 L8 23 L24 17 Z" fill="#c34a4a" stroke="#802f2f" strokeWidth="1" strokeLinejoin="round" />
      {/* body + nose cone */}
      <path d="M14 13 Q 16 6 34 6 L 46 6 Q 58 9 62 13 Q 58 17 46 20 L 34 20 Q 16 20 14 13 Z"
        fill="#dfe9f5" stroke="#52616c" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="38" cy="13" r="3.4" fill="#9fd8ff" stroke="#52616c" strokeWidth="1.2" />
    </svg>
  );
}

// The classic Atari wedge — a white outline ship with a flickering thruster.
// Battle damage appears as the hull degrades: scuffs below 75, a crack and
// embers below 50, a glowing breach + dulled outline below 25.
function ShipSvg({ hull }: { hull: number }) {
  const outline = hull > 50 ? '#eaf6ff' : hull > 25 ? '#ffd9b8' : '#ff9a7a';
  return (
    <svg viewBox="0 0 48 66" className="ast-ship-svg" role="img" aria-label="your ship">
      <polygon className="ast-flame" points="24,46 30,54 24,64 18,54" fill="#ffa73a" stroke="#ffd9a0" strokeWidth="1" />
      <polygon points="24,2 42,52 24,42 6,52" fill="#0b1022" stroke={outline} strokeWidth="2.5" strokeLinejoin="round" />
      <line x1="15" y1="38" x2="33" y2="38" stroke={outline} strokeWidth="1.6" />
      {hull < 75 && (
        <g stroke="#4a5a72" strokeWidth="1.6" strokeLinecap="round">
          <line x1="29" y1="18" x2="34" y2="24" />
          <line x1="32" y1="16" x2="35" y2="20" />
          <line x1="14" y1="34" x2="18" y2="30" />
        </g>
      )}
      {hull < 50 && (
        <g>
          <path d="M24 6 L21 15 L26 22 L22 30" stroke="#2c3850" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="26" cy="22" r="1.5" fill="#ff8a3a" className="alien-orb" />
          <circle cx="21" cy="15" r="1.1" fill="#ffb25a" className="alien-orb" />
        </g>
      )}
      {hull < 25 && (
        <g>
          <path d="M30 30 L36 36 L31 40 L35 45 L28 41 Z" fill="#1a0e08" stroke="#ff6a2a" strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="33" cy="38" r="1.7" fill="#ff6a2a" className="alien-orb" />
          <circle cx="17" cy="44" r="1.3" fill="#ff8a3a" className="alien-orb" />
        </g>
      )}
    </svg>
  );
}

export function Asteroids({ rounds, pool, language, avatarId, audio = true, paused = false, config, pineappleChance = 0.1, startTime, targetMs, targetLabel, onRetry, onAnswer, onComplete, onPineappleFound }: Props) {
  const total = rounds.length;
  const [roundIndex, setRoundIndex] = useState(0);
  const [runId, setRunId] = useState(0); // bumped on retry so the wave respawns
  const [gameOver, setGameOver] = useState(false);
  const [hull, setHull] = useState(MAX_HULL);
  // Per-wave rock state: hot (wrong shot — glowing, faster, harder-hitting) or
  // dead (the correct rock, exploded). Reset when the wave changes.
  const [status, setStatus] = useState<Record<string, 'hot' | 'dead'>>({});
  const [aimDeg, setAimDeg] = useState(0);
  const [bullet, setBullet] = useState<{ key: number; dx: number; dy: number } | null>(null);
  const [shards, setShards] = useState<Shard[]>([]);
  const [shipHit, setShipHit] = useState(false);
  // Floating "+N" over the ship when a decoy/rocket kill repairs the hull.
  const [healFlash, setHealFlash] = useState<{ key: number; amount: number } | null>(null);
  // Hidden pineapple: rolled once per game (survives retries — at most one find).
  const [pineapple] = useState(() => rollPineapple(pineappleChance));
  const [pineappleFound, setPineappleFound] = useState(false);
  const [yipeeOpen, setYipeeOpen] = useState(false);
  // Decorative traffic passing through the scene (cruiser + rockets).
  const [flybys, setFlybys] = useState<Flyby[]>([]);
  // Clicking the cruiser shows a 1s "Speech is Power" card (cruiser-shaped, larger).
  const [cruiserPopup, setCruiserPopup] = useState(false);
  const popupTimerRef = useRef(0);

  const resolvedRef = useRef(false);   // current wave settled (correct rock destroyed)
  const answeredRef = useRef(false);   // first shot graded to the API
  const advancingRef = useRef(false);  // in the celebrate gap between waves
  const firingRef = useRef(false);     // bullet in flight
  const doneRef = useRef(false);       // whole lesson finished
  const gameOverRef = useRef(false);

  const hullRef = useRef(MAX_HULL);
  const statusRef = useRef(status);
  const kinRef = useRef<Map<string, Kin>>(new Map());
  const rockEls = useRef<Map<string, HTMLButtonElement>>(new Map());
  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneSizeRef = useRef({ w: 360, h: 480 });
  const lastTsRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  const yipeeRef = useRef(false);      // freeze the rocks while the YIPEE card is up
  const hitTimerRef = useRef(0);
  const healTimerRef = useRef(0);
  const healSeqRef = useRef(0);
  const bulletKeyRef = useRef(0);
  // Drift-speed scale from the runtime config (waterRisePerSec ÷ its default),
  // so the same no-rebuild difficulty knob tunes this game too. Live via ref.
  const speedRef = useRef((config?.waterRisePerSec ?? BASE_RISE) / BASE_RISE);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { speedRef.current = (config?.waterRisePerSec ?? BASE_RISE) / BASE_RISE; }, [config]);

  // Cache the scene's pixel size so collision math never reads layout in the loop.
  useEffect(() => {
    const measure = () => {
      if (sceneRef.current) {
        sceneSizeRef.current = { w: sceneRef.current.offsetWidth, h: sceneRef.current.offsetHeight };
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const round = rounds[roundIndex];
  // An image on either side → identification; native↔English → translation.
  const mode: AnswerMode = round.clueKind === 'image' || round.choiceKind === 'image' ? 'identification' : 'translation';

  const rocks = useMemo(
    () => buildRocks(rounds[roundIndex].target, rounds[roundIndex].choiceKind, pool, language, `${runId}-${roundIndex}`),
    [rounds, roundIndex, pool, language, runId],
  );

  // New wave: seed the kinematics map from the spawn data and reset the flags.
  // Rock ids are unique per wave (`${runId}-${roundIndex}:…`), so the `status`
  // map needs no reset — entries for past waves are simply never looked up.
  useEffect(() => {
    kinRef.current = new Map(rocks.map((r) => [r.id, { x: r.x0, y: r.y0, vx: r.vx0, vy: r.vy0, spd: r.spd, rPx: r.sizePx * 0.44, decoy: r.decoy }]));
    for (const [id, k] of kinRef.current) {
      const el = rockEls.current.get(id);
      if (el) { el.style.left = `${k.x}%`; el.style.top = `${k.y}%`; }
    }
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
    firingRef.current = false;
  }, [rocks]);

  // Occasional decorative traffic: the PeakESL cruiser glides past every so
  // often, and rockets zip through in varying directions a bit more frequently.
  // Each flyby removes itself when its crossing finishes.
  useEffect(() => {
    let alive = true;
    const timers: number[] = [];
    function launch(make: (w: number, h: number) => Flyby, reschedule: () => void) {
      if (!alive) return;
      const { w, h } = sceneSizeRef.current;
      const fb = make(w, h);
      setFlybys((f) => [...f, fb]);
      timers.push(window.setTimeout(() => setFlybys((f) => f.filter((x) => x.id !== fb.id)), fb.dur * 1000 + 400));
      reschedule();
    }
    const scheduleCruiser = () => {
      timers.push(window.setTimeout(() => launch(makeCruiser, scheduleCruiser), 12000 + Math.random() * 18000));
    };
    const scheduleRocket = () => {
      timers.push(window.setTimeout(() => launch(makeRocket, scheduleRocket), 5000 + Math.random() * 9000));
    };
    const scheduleStar = () => {
      timers.push(window.setTimeout(() => launch(makeStar, scheduleStar), 3500 + Math.random() * 6500));
    };
    // First appearances early enough to be seen within a normal game.
    timers.push(window.setTimeout(() => launch(makeCruiser, scheduleCruiser), 4000 + Math.random() * 4000));
    timers.push(window.setTimeout(() => launch(makeRocket, scheduleRocket), 2000 + Math.random() * 3000));
    timers.push(window.setTimeout(() => launch(makeStar, scheduleStar), 1200 + Math.random() * 2000));
    return () => {
      alive = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // An asteroid rammed the ship: degrade the hull (hot rocks hit twice as hard),
  // flash/shake, and end the game when the hull is gone. Declared before the
  // loop effect below so its closure capture is well-ordered.
  function applyRam(hot: boolean) {
    hullRef.current = Math.max(0, hullRef.current - (hot ? HOT_DAMAGE : HIT_DAMAGE));
    setHull(hullRef.current);
    setShipHit(true);
    window.clearTimeout(hitTimerRef.current);
    hitTimerRef.current = window.setTimeout(() => setShipHit(false), 360);
    if (hullRef.current <= 0) {
      gameOverRef.current = true;
      setGameOver(true);
    }
  }

  // The drift loop: rocks close in on the centred ship from all directions and
  // ram it on contact (hull damage + flung radially away). Positions are
  // written imperatively — no per-frame re-render. rAF's timestamp gives dt.
  useEffect(() => {
    let raf = 0;
    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (last == null) return;
      const dt = Math.min(0.05, (ts - last) / 1000); // clamp big tab-switch gaps
      const live = !pausedRef.current && !yipeeRef.current && !advancingRef.current && !gameOverRef.current && !doneRef.current;
      if (!live) return;
      const { w, h } = sceneSizeRef.current;
      const st = statusRef.current;
      for (const [id, k] of kinRef.current) {
        if (st[id] === 'dead') continue;
        const mult = (st[id] === 'hot' ? HOT_SPEED_MULT : 1) * speedRef.current;
        const ox = SHIP_X - k.x;
        const oy = SHIP_Y - k.y;
        const od = Math.hypot(ox, oy) || 1;
        if (k.decoy) {
          // Decoys fly their own straight line — no homing — and wrap around
          // the screen edges, Atari-style. A pass may or may not cross the ship.
          k.x += k.vx * mult * dt;
          k.y += k.vy * mult * dt;
          if (k.x < -8) k.x = 108; else if (k.x > 108) k.x = -8;
          if (k.y < -8) k.y = 108; else if (k.y > 108) k.y = -8;
        } else {
          // Choice rocks steer toward the ship from wherever they are: nudge
          // velocity toward "straight at the ship at cruising speed" at
          // HOMING_ACCEL — a threat from any direction, including after knockback.
          k.vx += clamp((ox / od) * k.spd - k.vx, -HOMING_ACCEL * dt, HOMING_ACCEL * dt);
          k.vy += clamp((oy / od) * k.spd - k.vy, -HOMING_ACCEL * dt, HOMING_ACCEL * dt);
          k.x = clamp(k.x + k.vx * mult * dt, 4, 96);
          k.y = clamp(k.y + k.vy * mult * dt, 4, 96);
        }
        // Ship collision (px-space): ram → hull damage, rock flung radially away.
        const dx = ((k.x - SHIP_X) / 100) * w;
        const dy = ((k.y - SHIP_Y) / 100) * h;
        const reach = k.rPx + SHIP_RADIUS_PX;
        if (dx * dx + dy * dy < reach * reach) {
          k.x = clamp(k.x - (ox / od) * KNOCKBACK_PCT, 4, 96);
          k.y = clamp(k.y - (oy / od) * KNOCKBACK_PCT, 4, 96);
          k.vx = -(ox / od) * k.spd; // sail outward, then home back in
          k.vy = -(oy / od) * k.spd;
          applyRam(st[id] === 'hot');
        }
        const el = rockEls.current.get(id);
        if (el) { el.style.left = `${k.x}%`; el.style.top = `${k.y}%`; }
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Blasting space junk repairs the ship: +DECOY_HEAL per decoy rock,
  // +ROCKET_HEAL per rocket, capped at full hull. A "+N" floats over the ship.
  function repair(amount: number) {
    if (gameOverRef.current) return;
    hullRef.current = Math.min(MAX_HULL, hullRef.current + amount);
    setHull(hullRef.current);
    setHealFlash({ key: ++healSeqRef.current, amount });
    window.clearTimeout(healTimerRef.current);
    healTimerRef.current = window.setTimeout(() => setHealFlash(null), 1000);
  }

  function advance() {
    if (roundIndex + 1 >= total) {
      doneRef.current = true;
      onComplete();
    } else {
      setRoundIndex((i) => i + 1);
    }
  }

  // Click an asteroid → the ship swings to aim and fires; the shot resolves on
  // impact (BULLET_MS later). One bullet in flight at a time.
  function shoot(r: RockDef) {
    if (resolvedRef.current || gameOverRef.current || firingRef.current || statusRef.current[r.id]) return;
    const k = kinRef.current.get(r.id);
    if (!k) return;
    firingRef.current = true;
    const { w, h } = sceneSizeRef.current;
    const dx = ((k.x - SHIP_X) / 100) * w;
    const dy = ((k.y - SHIP_Y) / 100) * h;
    setAimDeg(Math.atan2(dx, -dy) * (180 / Math.PI));
    setBullet({ key: ++bulletKeyRef.current, dx, dy });
    window.setTimeout(() => resolveShot(r), BULLET_MS);
  }

  function resolveShot(r: RockDef) {
    firingRef.current = false;
    setBullet(null);
    if (gameOverRef.current || resolvedRef.current) return;

    const kd = kinRef.current.get(r.id);
    // Decoys are space junk: blast into shards, never graded, wave stays open —
    // and clearing one patches the hull a little.
    if (r.decoy) {
      setStatus((s) => ({ ...s, [r.id]: 'dead' }));
      if (kd) {
        const batch = makeShards(kd.x, kd.y, r.sizePx / 110);
        const ids = new Set(batch.map((d) => d.id));
        setShards((d) => [...d, ...batch]);
        window.setTimeout(() => setShards((d) => d.filter((p) => !ids.has(p.id))), 4200);
      }
      repair(DECOY_HEAL);
      return;
    }

    // Grade the first shot of the wave (one answer submitted per word).
    if (!answeredRef.current) {
      onAnswer(round.target.senseId, r.correct, mode);
      answeredRef.current = true;
    }

    const k = kinRef.current.get(r.id);
    if (r.correct) {
      resolvedRef.current = true;
      advancingRef.current = true; // freeze the field while the shards scatter
      setStatus((s) => ({ ...s, [r.id]: 'dead' }));
      if (k) {
        const batch = makeShards(k.x, k.y);
        const ids = new Set(batch.map((d) => d.id));
        setShards((d) => [...d, ...batch]);
        window.setTimeout(() => setShards((d) => d.filter((p) => !ids.has(p.id))), 4200);
      }
      if (audio) {
        if (roundIndex + 1 < total) playCorrect(); // final wave's victory trumpet covers it
        speakAvatar(round.target.english, avatarId);
      }
      window.setTimeout(advance, ADVANCE_DELAY_MS);
    } else {
      // Wrong rock: it survives the hit and goes GLOWING HOT — faster and twice
      // as damaging on contact. The wave stays open until the right rock is shot.
      setStatus((s) => ({ ...s, [r.id]: 'hot' }));
    }
  }

  // Traffic is clickable scenery: a rocket explodes into shards where it was
  // clicked; the cruiser shows the PeakESL "Speech is Power" popup for 2 seconds.
  function clickFlyby(f: Flyby, e: MouseEvent<HTMLButtonElement>) {
    if (f.kind === 'rocket') {
      const scene = sceneRef.current?.getBoundingClientRect();
      const el = e.currentTarget.getBoundingClientRect();
      if (scene && scene.width > 0) {
        const x = ((el.x + el.width / 2 - scene.x) / scene.width) * 100;
        const y = ((el.y + el.height / 2 - scene.y) / scene.height) * 100;
        const batch = makeShards(x, y, 0.55);
        const ids = new Set(batch.map((d) => d.id));
        setShards((d) => [...d, ...batch]);
        window.setTimeout(() => setShards((d) => d.filter((p) => !ids.has(p.id))), 4200);
      }
      setFlybys((fl) => fl.filter((x) => x.id !== f.id));
      repair(ROCKET_HEAL); // shooting down a rocket is a bigger hull patch
    } else {
      setCruiserPopup(true);
      window.clearTimeout(popupTimerRef.current);
      popupTimerRef.current = window.setTimeout(() => setCruiserPopup(false), 1000);
    }
  }

  function foundPineapple() {
    if (pineappleFound) return;
    setPineappleFound(true); // gone for the rest of the game
    yipeeRef.current = true; // stop the rocks while the card is up
    setYipeeOpen(true);
    onPineappleFound?.(); // App credits the token award (fire-and-forget)
  }

  function closeYipee() {
    yipeeRef.current = false;
    setYipeeOpen(false);
  }

  // Replay the whole run with a fresh hull. Answers already submitted this run
  // still counted server-side; re-answering simply re-scores those words.
  function retry() {
    onRetry?.(); // restart the run clock so the time measures only this attempt
    hullRef.current = MAX_HULL;
    gameOverRef.current = false;
    lastTsRef.current = null;
    setHull(MAX_HULL);
    setShards([]);
    setGameOver(false);
    setRoundIndex(0);
    setRunId((n) => n + 1); // force a wave respawn even though roundIndex may already be 0
  }

  function renderClue() {
    if (round.clueKind === 'image') {
      const src = imageUrl(round.target);
      return <div className="ast-clue-card image">{src && <img src={src} alt="" className="ast-clue-img" />}</div>;
    }
    const word = round.clueKind === 'nativeWord' ? nativeOf(round.target, language) : round.target.english;
    return <div className="ast-clue-card"><span className="ast-clue-word">{word}</span></div>;
  }

  const hullColor = hull > 50 ? '#42d977' : hull > 25 ? '#ffb22f' : '#ff5a5a';

  return (
    <div className="ast-game">
      <div className="ast-hud">
        <span className="ast-wave">{t('ast.wave', { n: roundIndex + 1, total })}</span>
        <p className="ast-instruction">{t('ast.instruction')}</p>
      </div>

      {/* Clue at the top … the asteroids below ARE the choices. */}
      <div className="ast-clue">{renderClue()}</div>

      <div className={`ast-scene${shipHit ? ' rumble' : ''}`} ref={sceneRef}>
        <div className="ast-stars" aria-hidden="true" />

        {/* Passing traffic — behind the rocks; clickable scenery (rockets pop,
            the cruiser shows the PeakESL card). */}
        {flybys.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`ast-flyby ${f.kind}`}
            style={{ left: `${f.x}%`, top: `${f.y}%`, '--dx': `${f.dxPx}px`, '--dy': `${f.dyPx}px`, '--dur': `${f.dur}s` } as CSSProperties}
            tabIndex={-1}
            aria-hidden="true"
            onClick={(e) => clickFlyby(f, e)}
          >
            <span className="ast-flyby-inner" style={{ transform: f.kind !== 'cruiser' ? `rotate(${f.deg}deg)` : f.flip ? 'scaleX(-1)' : undefined }}>
              {f.kind === 'cruiser' ? <CruiserSvg flip={f.flip} /> : f.kind === 'rocket' ? <RocketSvg /> : <span className="ast-star-streak" />}
            </span>
          </button>
        ))}

        {/* PeakESL cruiser popup — the same ship shape, larger, 2 seconds. */}
        {cruiserPopup && (
          <div className="ast-cruiser-popup" aria-hidden="true">
            <CruiserSvg slogan />
          </div>
        )}

        {/* Ship health — always visible, top-left. */}
        <div className="ast-hull" role="meter" aria-valuemin={0} aria-valuemax={MAX_HULL} aria-valuenow={hull} aria-label={t('ast.hull')}>
          <span className="ast-hull-label">{t('ast.hull')}</span>
          <span className="ast-hull-bar">
            <span className="ast-hull-fill" style={{ width: `${hull}%`, background: hullColor }} />
          </span>
          <span className="ast-hull-num" style={{ color: hullColor }}>{hull}</span>
        </div>

        {typeof startTime === 'number' && typeof targetMs === 'number' && targetMs > 0 && (
          <CountdownDial startTime={startTime} targetMs={targetMs} label={targetLabel} />
        )}

        {rocks.map((r) => {
          const st = status[r.id];
          if (st === 'dead') return null;
          return (
            <button
              key={r.id}
              type="button"
              className={`ast-rock${r.img ? ' image' : ''}${r.decoy ? ' decoy' : ''}${st === 'hot' ? ' hot' : ''}${r.reverse ? ' rev' : ''}`}
              style={{ width: r.sizePx, height: r.sizePx, '--spin-dur': `${r.spinDur}s` } as CSSProperties}
              disabled={!!st || gameOver}
              ref={(el) => {
                if (el) {
                  rockEls.current.set(r.id, el);
                  const k = kinRef.current.get(r.id);
                  el.style.left = `${k ? k.x : r.x0}%`;
                  el.style.top = `${k ? k.y : r.y0}%`;
                } else {
                  rockEls.current.delete(r.id);
                }
              }}
              onClick={() => shoot(r)}
            >
              <svg className="ast-rock-body" viewBox="0 0 100 100" aria-hidden="true">
                <polygon points={r.points} />
              </svg>
              <span className="ast-rock-content">
                {r.img ? <img src={r.img} alt="" /> : r.label}
              </span>
            </button>
          );
        })}

        {bullet && (
          <span
            key={bullet.key}
            className="ast-bullet"
            style={{ left: `${SHIP_X}%`, top: `${SHIP_Y}%`, '--dx': `${bullet.dx}px`, '--dy': `${bullet.dy}px` } as CSSProperties}
            aria-hidden="true"
          />
        )}

        {shards.map((d) => (
          <svg
            key={d.id}
            className="ast-shard"
            viewBox="0 0 100 100"
            style={{
              left: `${d.x}%`, top: `${d.y}%`, width: d.size, height: d.size,
              '--dx': `${d.dx}px`, '--dy': `${d.dy}px`, '--dur': `${d.dur}s`,
            } as CSSProperties}
            aria-hidden="true"
          >
            <polygon points={d.points} />
          </svg>
        ))}

        <div
          className={`ast-ship${shipHit ? ' hit' : ''}`}
          style={{ left: `${SHIP_X}%`, top: `${SHIP_Y}%`, transform: `translate(-50%, -50%) rotate(${aimDeg}deg)` }}
        >
          <ShipSvg hull={hull} />
        </div>
        {healFlash && (
          <div key={healFlash.key} className="ast-heal" style={{ left: `${SHIP_X}%`, top: `calc(${SHIP_Y}% - 48px)` }} aria-hidden="true">
            +{healFlash.amount}
          </div>
        )}

        {pineapple && !pineappleFound && (
          <button
            type="button"
            className="ast-pineapple"
            style={{ left: `${pineapple.left}%`, top: `${pineapple.top}%` }}
            tabIndex={-1}
            onClick={foundPineapple}
            aria-hidden="true"
          >
            <AlienPineapple />
          </button>
        )}

        {gameOver && (
          <div className="ast-over">
            <div className="ast-over-title">{t('ast.gameOver')}</div>
            <p className="ast-over-hint">{t('ast.gameOverHint')}</p>
            <button type="button" className="ast-retry-btn" onClick={retry}>{t('ast.retry')}</button>
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
