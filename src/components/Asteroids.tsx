import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { ChoiceKind, ClimbRound } from '../game/lesson';
import type { GameConfig } from '../lib/gameConfig';
import { imageUrl } from '../lib/appApi';
import { pickN, shuffle } from '../lib/shuffle';
import { speakAvatar } from '../lib/speech';
import { playCorrect } from '../lib/sound';
import { CountdownDial } from './CountdownDial';
import { Pineapple } from './ClimbToSafety';
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

// Threat model: asteroids drift down toward the ship at the bottom; shooting the
// correct one clears the wave, a wrong shot turns that rock GLOWING HOT (faster,
// hits twice as hard). A rock that reaches the ship rams it — hull damage — and
// is flung back to the top to come around again. Hull 0 → ship destroyed; clear
// all waves to survive. The config's waterRisePerSec doubles as the speed knob
// here (scaled against its own default) so the same runtime config tunes both games.
const MAX_HULL = 100;
const HIT_DAMAGE = 15;           // normal asteroid ramming the ship
const HOT_DAMAGE = 30;           // a glowing-hot rock hits twice as hard
const HOT_SPEED_MULT = 1.9;      // …and falls almost twice as fast
const DRIFT_PER_SEC = 2.1;       // baseline downward drift (% of scene height / sec)
const BASE_RISE = 0.9;           // gameConfig.waterRisePerSec default → speed scale of 1
const KNOCKBACK_PCT = 34;        // how far up (%) a rock is flung after ramming the ship
const HOMING_ACCEL = 8;          // %/s² — how hard a rock steers onto an intercept course
const MAX_VX = 14;               // %/s — cap on sideways speed from homing
const BULLET_MS = 150;           // bullet flight time; the shot resolves on impact
const SHIP_X = 50;               // ship centre, % of scene width
const SHIP_Y = 88;               // ship centre, % of scene height (from the top)
const SHIP_RADIUS_PX = 30;       // collision radius around the ship centre
const PARTICLE_COUNT = 16;       // debris flecks per destroyed asteroid

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function nativeOf(w: ApiWord, language: LanguageCode): string | undefined {
  return w.translations?.[language]?.[0]?.word;
}

// Static per-wave asteroid data; live position/velocity is mutated in a kin map
// (a ref) and written to the DOM imperatively, so drifting never re-renders.
interface RockDef {
  id: string;
  correct: boolean;
  label?: string;
  img?: string;
  sizePx: number;      // button diameter (also the collision size)
  points: string;      // jagged polygon for the 100×100 viewBox
  spinDur: number;     // seconds per revolution
  reverse: boolean;    // spin direction
  x0: number; y0: number;    // spawn centre, % of scene
  vx0: number; vy0: number;  // velocity, %/sec
}
interface Kin { x: number; y: number; vx: number; vy: number; rPx: number; }

interface Debris { id: number; x: number; y: number; dx: number; dy: number; dur: number; size: number; }

// A classic Atari-style jagged rock outline: 11 vertices at randomised radii.
function makeRockPoints(): string {
  const n = 11;
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
// spawned in its own horizontal lane near the top, drifting down at the ship.
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
  const span = 76 / Math.max(1, choices.length - 1);
  return choices.map((c, i) => ({
    ...c,
    id: `${keyPrefix}:${c.id}`, // unique across waves/retries so DOM refs never collide
    sizePx: c.img ? 96 : 110,
    points: makeRockPoints(),
    spinDur: 16 + Math.random() * 16,
    reverse: Math.random() < 0.5,
    x0: clamp(12 + span * i + (Math.random() * 8 - 4), 10, 90),
    y0: 8 + Math.random() * 12,
    vx0: (Math.random() * 2 - 1) * 3.5,
    vy0: DRIFT_PER_SEC * (0.8 + Math.random() * 0.5),
  }));
}

let debrisSeq = 0;
// The kill burst: flecks flung outward that keep floating off through space.
function makeDebris(x: number, y: number): Debris[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    const a = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 130;
    return {
      id: ++debrisSeq,
      x, y,
      dx: Math.cos(a) * dist,
      dy: Math.sin(a) * dist,
      dur: 1.8 + Math.random() * 1.6,
      size: 2 + Math.random() * 3.5,
    };
  });
}

// Hidden-pineapple easter egg, adrift in deep space this time. Same contract as
// the climb game: rolled once per game, at most one find, spawn odds usage-driven.
function rollPineapple(chance: number): { left: number; top: number } | null {
  if (Math.random() >= chance) return null;
  return { left: 6 + Math.random() * 84, top: 26 + Math.random() * 42 };
}

// The classic Atari wedge — a white outline ship with a flickering thruster.
function ShipSvg() {
  return (
    <svg viewBox="0 0 48 66" className="ast-ship-svg" role="img" aria-label="your ship">
      <polygon className="ast-flame" points="24,46 30,54 24,64 18,54" fill="#ffa73a" stroke="#ffd9a0" strokeWidth="1" />
      <polygon points="24,2 42,52 24,42 6,52" fill="#0b1022" stroke="#eaf6ff" strokeWidth="2.5" strokeLinejoin="round" />
      <line x1="15" y1="38" x2="33" y2="38" stroke="#eaf6ff" strokeWidth="1.6" />
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
  const [debris, setDebris] = useState<Debris[]>([]);
  const [shipHit, setShipHit] = useState(false);
  // Hidden pineapple: rolled once per game (survives retries — at most one find).
  const [pineapple] = useState(() => rollPineapple(pineappleChance));
  const [pineappleFound, setPineappleFound] = useState(false);
  const [yipeeOpen, setYipeeOpen] = useState(false);

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
    kinRef.current = new Map(rocks.map((r) => [r.id, { x: r.x0, y: r.y0, vx: r.vx0, vy: r.vy0, rPx: r.sizePx * 0.44 }]));
    for (const [id, k] of kinRef.current) {
      const el = rockEls.current.get(id);
      if (el) { el.style.left = `${k.x}%`; el.style.top = `${k.y}%`; }
    }
    resolvedRef.current = false;
    answeredRef.current = false;
    advancingRef.current = false;
    firingRef.current = false;
  }, [rocks]);

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

  // The drift loop: rocks fall toward the ship, bounce off the side walls, and
  // ram the ship on contact (hull damage + flung back to the top). Positions are
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
        // Steer onto an intercept course: the vx that would meet the ship at
        // impact time, approached at HOMING_ACCEL — so every rock is a threat,
        // not just the ones that spawned over the ship.
        if (k.y < SHIP_Y) {
          const tti = Math.max(0.8, (SHIP_Y - k.y) / (k.vy * mult));
          const wantVx = clamp((SHIP_X - k.x) / tti, -MAX_VX, MAX_VX);
          k.vx += clamp(wantVx - k.vx, -HOMING_ACCEL * dt, HOMING_ACCEL * dt);
        }
        k.x += k.vx * mult * dt;
        k.y += k.vy * mult * dt;
        if (k.x < 9) { k.x = 9; k.vx = Math.abs(k.vx); }
        if (k.x > 91) { k.x = 91; k.vx = -Math.abs(k.vx); }
        if (k.y > 106) k.y = 4; // slipped past the ship → wrap to the top, Atari-style
        // Ship collision (px-space): ram → hull damage, rock flung back up top.
        const dx = ((k.x - SHIP_X) / 100) * w;
        const dy = ((k.y - SHIP_Y) / 100) * h;
        const reach = k.rPx + SHIP_RADIUS_PX;
        if (dx * dx + dy * dy < reach * reach) {
          k.y = Math.max(5, k.y - KNOCKBACK_PCT);
          applyRam(st[id] === 'hot');
        }
        const el = rockEls.current.get(id);
        if (el) { el.style.left = `${k.x}%`; el.style.top = `${k.y}%`; }
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

    // Grade the first shot of the wave (one answer submitted per word).
    if (!answeredRef.current) {
      onAnswer(round.target.senseId, r.correct, mode);
      answeredRef.current = true;
    }

    const k = kinRef.current.get(r.id);
    if (r.correct) {
      resolvedRef.current = true;
      advancingRef.current = true; // freeze the field while the debris scatters
      setStatus((s) => ({ ...s, [r.id]: 'dead' }));
      if (k) {
        const batch = makeDebris(k.x, k.y);
        const ids = new Set(batch.map((d) => d.id));
        setDebris((d) => [...d, ...batch]);
        window.setTimeout(() => setDebris((d) => d.filter((p) => !ids.has(p.id))), 3800);
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
    setDebris([]);
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
              className={`ast-rock${r.img ? ' image' : ''}${st === 'hot' ? ' hot' : ''}${r.reverse ? ' rev' : ''}`}
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

        {debris.map((d) => (
          <span
            key={d.id}
            className="ast-debris"
            style={{
              left: `${d.x}%`, top: `${d.y}%`, width: d.size, height: d.size,
              '--dx': `${d.dx}px`, '--dy': `${d.dy}px`, '--dur': `${d.dur}s`,
            } as CSSProperties}
            aria-hidden="true"
          />
        ))}

        <div
          className={`ast-ship${shipHit ? ' hit' : ''}`}
          style={{ left: `${SHIP_X}%`, top: `${SHIP_Y}%`, transform: `translate(-50%, -50%) rotate(${aimDeg}deg)` }}
        >
          <ShipSvg />
        </div>

        {pineapple && !pineappleFound && (
          <button
            type="button"
            className="ast-pineapple"
            style={{ left: `${pineapple.left}%`, top: `${pineapple.top}%` }}
            tabIndex={-1}
            onClick={foundPineapple}
            aria-hidden="true"
          >
            <Pineapple />
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
