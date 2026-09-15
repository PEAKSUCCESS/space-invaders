// Space Invaders — the game itself: a fixed-step simulation plus a Canvas 2D
// renderer on a 320×256 logical screen. React only hosts the canvas and feeds
// input (SpaceInvaders.tsx); what to ask and how to score it lives in invaders.ts.
//
// State machine: ATTRACT → BRIEF → WAVE → WAVE CLEAR → REPORT → (BRIEF | FINAL).
// A formation of word tiles descends on the cannon; only the front row is live.
// A correct shot clears the row and the formation gives up a row-height of
// ground; a wrong shot clears it too but the ranks close up, so no ground is
// gained. There's no separate clock: a row that reaches the shield line has its
// answer revealed, burns a shield segment (a cannon when none are left), and the
// formation falls back to the top.
import type { AnswerMode, ApiWord, LanguageCode } from '../types';
import type { StringKey } from '../i18n/strings';
import { drawText, fitLines, fitScale, measure } from './bitmapFont';
import {
  COLS, ROW_PITCH, SLOW_MS, TILE_GAP, TILE_H, TILE_W,
  answerMode, nativeOf, planWave, promptPoints, promptText, streakMultiplier, tierFor,
  type Outcome, type PlanContext, type Prompt, type RoundKind, type Style, type TileDef,
} from './invaders';
import {
  sfxBombDrop, sfxCorrect, sfxExplosion, sfxFire, sfxMarch, sfxPowerUp, sfxShieldHit, sfxTimeout, sfxUfo, sfxWaveClear, sfxWrong,
} from '../lib/sound';
import { t } from '../i18n/i18n';

export const W = 320;
export const H = 256;

const HUD_H = 11;
const SPAWN_Y = 44;             // front row's bottom edge at wave start
const SHIELD_Y = 204;           // contact line — 160px of travel from spawn
const CANNON_TOP = 208;
const BAR_Y = 219;              // the prompt bar the cannon "carries"
const SAUCER_Y = HUD_H + 2;       // clear of the front row at spawn (its top edge is y 20)
const FORM_LEFT = 7;
const MARCH_RANGE = 4;          // lateral drift, px either side
const BULLET_SPEED = 300;
const BOMB_SPEED = 260;
const CANNON_SPEED = 150;
const SEEK_SPEED = 280;         // tap-to-aim glide
const SHAKE_SEC = 0.25;         // wrong tile shakes…
const PULSE_SEC = 0.6;          // …then the right one pulses amber
const CLEAR_SEC = 0.3;
const BRIEF_SEC = 2.2;
const WAVE_CLEAR_SEC = 1.8;
const REPORT_ITEM_SEC = 4;
const REPORT_MIN_SEC = 1;
const LOST_SEC = 1.4;
const SLOW_SEC = 10;
const UFO_SPEED = 40;
const PINEAPPLE_SPEED = 26;
const PERFECT_BONUS = 1000;
const SHIELDS_DOWN_MULT = 1.25;
const CANNONS = 3;
// One bunker under each word column (centres 36 / 98 / 160 / 222 / 284), with the
// gaps between columns — so a cannon parked under a word is covered until that
// bunker wears through.
const SHIELD_SEGS: Array<[number, number]> = [[4, 63], [71, 125], [133, 187], [195, 249], [257, 316]];
// Shields are pixel bunkers, eroded one crater at a time. They sit between the
// formation's breach line and the cannon, so a bomb only reaches the cannon
// through a gap or a hole it (or earlier bombs) blasted.
const SHIELD_TOP = SHIELD_Y - 1;
const SHIELD_ROWS = 5;
const SHIELD_STANDING = 0.15;          // a bunker with less than this left counts as destroyed
// The ships' own bombs: a small crater each. Only the live row drops them, and
// never in practice. Most are aimed — angled at where the cannon is when they
// drop — so standing still doesn't work; the rest fall straight from any ship.
const SHIP_BOMB_SPEED = 110;
const SHIP_BOMB_MAX = 5;
const SHIP_BOMB_AIMED = 0.6;           // share of bombs aimed at the cannon
const SHIP_BOMB_MAX_DRIFT = 45;        // px/s — how steeply an aimed bomb can angle
const SHIP_BOMB_SPREAD = 9;           // aimed bombs land within ±this of the cannon, not on one pixel
const SHIP_BOMB_CRATER = 2;
const WRONG_BOMB_CRATER = 8;
const BREACH_CRATER = 12;              // a row landing on the shields blasts a big hole, not the whole bunker
const SHIP_BOMB_EVERY = [2.0, 1.6, 1.35, 1.15, 1.0]; // seconds between drops, by ramp tier
const SHIP_BOMB_GRACE = 2.5;                     // quiet seconds at the start of each wave
const START_BTN = { x: 90, y: 150, w: 140, h: 17 };
const PRACTICE_BTN = { x: 90, y: 172, w: 140, h: 17 };

// 16-colour palette on the Peak amber; phosphor cyan for structure, green for
// correct, red only for error states.
const P = {
  black: '#000000', night: '#070B1E', navy: '#1D2B53', grey: '#5F6573', silver: '#C2C3C7', white: '#FFFFFF',
  amber: '#FFB22F', amberPale: '#FFE3A3', amberDark: '#7A4B00',
  cyan: '#3FF3FF', cyanDim: '#157C86', cyanDark: '#0B3A42',
  green: '#54FF7A', greenDark: '#1E8A3C', red: '#FF4C4C', magenta: '#FF6AD5',
} as const;

// Original sprites (not Taito's): a treaded turret and a domed saucer.
const CANNON_ART = [
  '......#......',
  '......#......',
  '....#####....',
  '...##...##...',
  '.###########.',
  '#############',
  '#.#.#.#.#.#.#',
  '.#.#.#.#.#.#.',
];
const SAUCER_ART = [
  '......####......',
  '.....#....#.....',
  '...##########...',
  '.##############.',
  '#.#.#.#.#.#.#.#.',
  '.##############.',
  '....#......#....',
];
// Word-carrier hulls: each formation row is a different colour of alien ship
// (gold outline, a domed cockpit with eyes on top, running lights along the
// belly). Red and green stay reserved for wrong / right, amber for the answer
// pulse — so hulls use magenta, violet and teal, and UFO rounds fly gold.
interface Hull { body: string; shade: string; edge: string; dome: string }
const HULLS: Hull[] = [
  { body: '#FF4FB8', shade: '#A82A77', edge: '#FFB22F', dome: '#3FF3FF' },
  { body: '#9B5CFF', shade: '#5B2DB5', edge: '#FFB22F', dome: '#3FF3FF' },
  { body: '#14C8B4', shade: '#0A7A6E', edge: '#FFE3A3', dome: '#FF6AD5' },
];
const UFO_HULL: Hull = { body: '#FFB22F', shade: '#7A4B00', edge: '#FFE3A3', dome: '#FF6AD5' };
const WRONG_HULL: Hull = { body: '#5F6573', shade: '#3A3F4A', edge: '#FF4C4C', dome: '#5F6573' };
const SCREEN = '#070B1E';

const BOMB_ART = [['.#.', '#..', '.#.', '..#', '.#.'], ['.#.', '..#', '.#.', '#..', '.#.']];

const ROUND_LABEL: Record<RoundKind, StringKey> = { A: 'inv.roundA', B: 'inv.roundB', C: 'inv.roundC', D: 'inv.roundD' };
const BRIEF_LINE: Record<Style, StringKey> = { A: 'inv.briefA', B: 'inv.briefB', C: 'inv.briefC' };

type Phase = 'attract' | 'brief' | 'wave' | 'waveClear' | 'report' | 'final';
type PowerUp = 'slow' | 'scan' | 'echo';
const POWER_LABEL: Record<PowerUp, StringKey> = { slow: 'inv.slow', scan: 'inv.scan', echo: 'inv.echo' };
const POWER_NOTE: Record<PowerUp, StringKey> = { slow: 'inv.slowNote', scan: 'inv.scanNote', echo: 'inv.echoNote' };
const NOTE_SEC = 2.4;
const NOTE_Y = CANNON_TOP - 30; // clear of the SHIELDS DOWN / SLOW status line

interface LiveTile { def: TileDef; col: number; state: 'idle' | 'wrong' | 'scanned' | 'hit' }
interface Row { prompt: Prompt; tiles: Array<LiveTile | null>; hull: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; colors: readonly string[] }
interface Floater { x: number; y: number; text: string; color: string; t: number; life: number }
interface Bomb { x: number; y: number; vx: number; vy: number; big: boolean }
interface Saucer { x: number; dir: 1 | -1; kind: 'ufo' | 'pineapple'; stop: () => void }
interface Capsule { x: number; y: number; kind: PowerUp }

interface Logged { prompt: Prompt; outcome: Outcome; latencyMs: number; responseId: string | null; wave: number; ord: number }

/** One shot fired (or one row reaching the shields) — the shape a future game_event row takes. */
export interface InvaderEvent {
  senseId: string;
  roundKind: RoundKind;
  wave: number;
  promptOrd: number;
  distractorIds: string[];
  responseSenseId: string | null;
  outcome: Outcome;
  latencyMs: number;
}

export interface InvadersResult {
  score: number;
  practice: boolean;
  gameOver: boolean;
  wavesCleared: number;
  exposures: number;
  correct: number;
  slow: number;
  missed: number;
  accuracy: number;     // 0–1, correct (incl. slow) / exposures
  bestStreak: number;
  durationMs: number;
  events: InvaderEvent[];
}

export interface EngineOptions {
  targets: ApiWord[];
  pool: ApiWord[];
  language: LanguageCode;
  picsOnly: boolean;
  waves: number;
  promptsPerWave: number;
  descentScale: number;
  approachScale: number;
  pineapple: boolean;
  reducedMotion: boolean;
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onLive: (word: ApiWord | null) => void;
  onComplete: (result: InvadersResult) => void;
  onPineapple: () => void;
  speak: (text: string, lang: LanguageCode | 'en') => void;
}

const pad6 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, '0');
const inRect = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function sprite(ctx: CanvasRenderingContext2D, art: string[], x: number, y: number, color: string) {
  ctx.fillStyle = color;
  for (let r = 0; r < art.length; r++) {
    const line = art[r];
    for (let c = 0; c < line.length; c++) if (line[c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
  }
}

export class InvadersEngine {
  private readonly o: EngineOptions;
  private audio = true;
  private hold = false;
  private best = 0;
  private readonly pictures = new Map<string, CanvasImageSource>();

  private phase: Phase = 'attract';
  private phaseT = 0;
  private time = 0;

  // session
  private practice = false;
  private startedAt = 0;
  private wave = 0;
  private waveStyle: Style = 'A';
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private cannons = CANNONS;
  private bunkers: Uint8Array[] = SHIELD_SEGS.map(() => new Uint8Array(0));
  private shieldsDown = false;
  private bombT = 0;
  private slowT = 0;
  private scanPending = false;
  private wavesCleared = 0;
  private perfect = false;
  private gameOver = false;
  private completed = false;
  private readonly misses = new Map<string, ApiWord>();
  private log: Logged[] = [];
  private waveLog: Logged[] = [];
  private promptOrd = 0;
  private pineappleOrd = -1;

  // formation
  private rows: Row[] = [];
  private frontY = SPAWN_Y;
  private offset = 0;           // visual lag after the ranks move; eases to 0
  private marchDx = 0;
  private marchDir = 1;
  private marchT = 0;
  private marchFrame = 0;
  private marchStep = 0;

  // current prompt
  private promptState: 'idle' | 'live' | 'reveal' | 'clear' = 'idle';
  private promptT = 0;
  private stateT = 0;
  private revealWrong = false;
  private breach = false;        // the revealed row got all the way down to the shields
  private breachCannon = false;  // …and there were no shields left to take it
  private lostT = 0;

  // actors & input
  private cannonX = W / 2;
  private seekX: number | null = null;
  private fireOnArrive = false;
  private fireWaitT = 0;
  private drag: { x0: number; t0: number; moved: boolean } | null = null;
  private keyLeft = false;
  private keyRight = false;
  private padAxis = 0;
  private padFire = false;
  private padStart = false;
  private bullet: { x: number; y: number } | null = null;
  private bombs: Bomb[] = [];
  private saucer: Saucer | null = null;
  private capsule: Capsule | null = null;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shakeT = 0;
  private readonly stars: Array<{ x: number; y: number; s: number; c: string }>;
  private readonly demo: Array<LiveTile | null>;

  // report
  private reportItems: ApiWord[] = [];
  private reportIdx = 0;

  constructor(o: EngineOptions) {
    this.o = o;
    this.stars = Array.from({ length: 48 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      s: 2 + Math.random() * 6,
      c: Math.random() < 0.2 ? P.silver : Math.random() < 0.5 ? P.grey : P.navy,
    }));
    const words = o.targets.length > 0 ? o.targets : o.pool;
    this.demo = Array.from({ length: COLS }, (_, col) => {
      const w = words[col % Math.max(1, words.length)];
      const lines = w ? fitLines(w.english, TILE_W - 6) : null;
      return w && lines ? { def: { word: w, lines, correct: false }, col, state: 'idle' } : null;
    });
  }

  // ── Host API ───────────────────────────────────────────────────────────────

  setAudio(on: boolean) { this.audio = on; }
  setHold(on: boolean) { this.hold = on; }
  setBest(score: number) { this.best = Math.max(this.best, score); }
  /** A high-resolution copy of the word's picture. The canvas backing store runs
   *  at device resolution, so it is drawn smoothed — unlike the pixel art. */
  setPicture(senseId: string, picture: CanvasImageSource) {
    this.pictures.set(senseId, picture);
  }

  dispose() {
    this.saucer?.stop();
  }

  /** Returns true when the key is a game key (the host then prevents default). */
  keyDown(code: string): boolean {
    if (this.hold) return false;
    switch (code) {
      case 'ArrowLeft': case 'KeyA':
        this.keyLeft = true;
        return true;
      case 'ArrowRight': case 'KeyD':
        this.keyRight = true;
        return true;
      case 'Space': case 'ArrowUp': case 'KeyW': case 'Enter':
        this.action();
        return true;
      case 'KeyP':
        if (this.phase === 'attract') this.start(true);
        return this.phase === 'attract';
    }
    return false;
  }

  keyUp(code: string) {
    if (code === 'ArrowLeft' || code === 'KeyA') this.keyLeft = false;
    if (code === 'ArrowRight' || code === 'KeyD') this.keyRight = false;
  }

  gamepad(axis: number, fire: boolean, start: boolean) {
    this.padAxis = Math.abs(axis) > 0.35 ? Math.sign(axis) : 0;
    if (!this.hold) {
      if (fire && !this.padFire) this.action();
      if (start && !this.padStart) this.action();
    }
    this.padFire = fire;
    this.padStart = start;
  }

  pointerDown(x: number, y: number) {
    if (this.hold) return;
    if (this.phase === 'attract') {
      this.start(inRect(PRACTICE_BTN, x, y));
      return;
    }
    if (this.phase !== 'wave') {
      this.action();
      return;
    }
    const s = this.saucer;
    const onSaucer = !!s && x >= s.x - 4 && x < s.x + 20 && y >= SAUCER_Y - 7 && y < SAUCER_Y + 11;
    if (onSaucer && s!.kind === 'pineapple') {
      this.findPineapple();
      return;
    }
    if (this.lostT > 0) return;
    if (y >= SHIELD_Y - 4) {
      // Bottom strip: drag to move, a quick tap fires where it lands.
      this.drag = { x0: x, t0: this.time, moved: false };
      this.seekX = x;
      this.fireOnArrive = false;
      return;
    }
    // Above the shield line: glide under what was tapped and fire.
    const col = this.colAt(x);
    const tile = this.rows[0]?.tiles[col];
    this.seekX = !onSaucer && tile && tile.state === 'idle' ? this.tileX(col) + TILE_W / 2 : x;
    this.fireOnArrive = true;
    this.fireWaitT = 0;
  }

  pointerMove(x: number) {
    if (!this.drag) return;
    this.seekX = x;
    if (Math.abs(x - this.drag.x0) > 4) this.drag.moved = true;
  }

  pointerUp() {
    if (!this.drag) return;
    if (!this.drag.moved && this.time - this.drag.t0 < 0.3) {
      this.fireOnArrive = true;
      this.fireWaitT = 0;
    }
    this.drag = null;
  }

  // ── Flow ───────────────────────────────────────────────────────────────────

  private get totalPrompts() { return this.o.waves * this.o.promptsPerWave; }
  private get approachSec() { return tierFor(this.wave).approachSec * this.o.approachScale; }
  /** Logical px/s so a row crosses spawn → shield line in approachSec. */
  private get descentSpeed() { return ((SHIELD_Y - SPAWN_Y) / this.approachSec) * this.o.descentScale; }

  private action() {
    switch (this.phase) {
      case 'attract': this.start(false); break;
      case 'brief': if (this.phaseT > 0.4) this.beginWave(); break;
      case 'wave': this.fire(); break;
      case 'waveClear': if (this.phaseT > 0.8) this.afterWave(); break;
      case 'report': if (this.phaseT > REPORT_MIN_SEC) this.nextReportItem(); break;
      case 'final': if (this.phaseT > 1) this.finish(); break;
    }
  }

  private start(practice: boolean) {
    this.practice = practice;
    this.startedAt = performance.now();
    this.wave = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.cannons = CANNONS;
    this.resetBunkers();
    this.wavesCleared = 0;
    this.gameOver = false;
    this.shieldsDown = false;
    this.slowT = 0;
    this.scanPending = false;
    this.lostT = 0;
    this.capsule = null;
    this.completed = false;
    this.misses.clear();
    this.log = [];
    this.promptOrd = 0;
    // Hidden pineapple: at most one saucer per game, somewhere past the opening prompts.
    this.pineappleOrd = this.o.pineapple ? 4 + Math.floor(Math.random() * Math.max(1, this.totalPrompts * 0.5)) : -1;
    this.nextWave();
  }

  private planContext(): PlanContext {
    return {
      language: this.o.language,
      targets: this.o.targets,
      pool: this.o.pool,
      hasPicture: (w) => this.pictures.has(w.senseId),
      misses: this.misses,
      picsOnly: this.o.picsOnly,
    };
  }

  private nextWave() {
    if (this.wave >= this.o.waves) {
      this.toFinal();
      return;
    }
    this.wave++;
    const plan = planWave(this.wave, this.o.promptsPerWave, this.planContext(), this.wave >= 2 && !this.o.picsOnly);
    if (!plan || plan.prompts.length === 0) {
      this.toFinal();
      return;
    }
    this.waveStyle = plan.style;
    this.rows = plan.prompts.map((prompt, i) => ({
      prompt,
      hull: i % HULLS.length,
      tiles: prompt.tiles.map((def, col) => (def ? { def, col, state: 'idle' as const } : null)),
    }));
    this.frontY = SPAWN_Y;
    this.offset = -150; // the formation drops in from above during the brief
    this.shieldsDown = false;
    this.bombT = SHIP_BOMB_GRACE;
    this.waveLog = [];
    this.promptState = 'idle';
    this.bullet = null;
    this.bombs = [];
    this.phase = 'brief';
    this.phaseT = 0;
    this.o.onLive(null);
  }

  private beginWave() {
    this.phase = 'wave';
    this.phaseT = 0;
    this.startPrompt();
  }

  private startPrompt() {
    const row = this.rows[0];
    // A shot or tap still pending from the last prompt must not grade this one.
    this.bullet = null;
    this.fireOnArrive = false;
    this.promptState = 'live';
    this.promptT = 0;
    this.stateT = 0;
    this.revealWrong = false;
    this.breach = false;
    this.promptOrd++;
    if (this.scanPending) {
      this.scanPending = false;
      this.applyScan(row);
      this.float(this.cannonX, NOTE_Y, t('inv.scanNote'), P.cyan, NOTE_SEC);
    }
    this.o.onLive(row.prompt.target);
    if (row.prompt.kind === 'D' && !this.saucer) {
      this.spawnSaucer('ufo');
    } else if (this.pineappleOrd >= 0 && this.promptOrd >= this.pineappleOrd && !this.saucer) {
      this.pineappleOrd = -1;
      this.spawnSaucer('pineapple');
    }
  }

  private endWave() {
    this.wavesCleared++;
    this.clearSaucer();
    this.capsule = null;
    this.bombs = [];
    this.bullet = null;
    this.shieldsDown = false;
    this.promptState = 'idle';
    this.perfect = this.waveLog.length > 0 && this.waveLog.every((e) => e.outcome === 'correct' || e.outcome === 'correct_slow');
    if (this.perfect) {
      this.score += PERFECT_BONUS;
      this.resetBunkers();
    }
    this.phase = 'waveClear';
    this.phaseT = 0;
    this.o.onLive(null);
    if (this.audio) sfxWaveClear();
  }

  private afterWave() {
    const seen = new Set<string>();
    this.reportItems = [];
    for (const e of this.waveLog) {
      if ((e.outcome === 'wrong' || e.outcome === 'timeout') && !seen.has(e.prompt.target.senseId)) {
        seen.add(e.prompt.target.senseId);
        this.reportItems.push(e.prompt.target);
      }
    }
    if (this.reportItems.length > 0) {
      this.phase = 'report';
      this.phaseT = 0;
      this.reportIdx = 0;
      this.speakReportItem();
    } else if (this.gameOver) {
      this.toFinal();
    } else {
      this.nextWave();
    }
  }

  private nextReportItem() {
    this.reportIdx++;
    this.phaseT = 0;
    if (this.reportIdx < this.reportItems.length) {
      this.speakReportItem();
    } else if (this.gameOver) {
      this.toFinal();
    } else {
      this.nextWave();
    }
  }

  private speakReportItem() {
    if (this.audio) this.o.speak(this.reportItems[this.reportIdx].english, 'en');
  }

  private toFinal() {
    this.clearSaucer();
    this.phase = 'final';
    this.phaseT = 0;
    this.promptState = 'idle';
    this.o.onLive(null);
  }

  private finish() {
    if (this.completed) return;
    this.completed = true;
    const count = (o: Outcome) => this.log.filter((e) => e.outcome === o).length;
    const correct = count('correct');
    const slow = count('correct_slow');
    const exposures = this.log.length;
    this.o.onComplete({
      score: this.score,
      practice: this.practice,
      gameOver: this.gameOver,
      wavesCleared: this.wavesCleared,
      exposures,
      correct,
      slow,
      missed: count('wrong') + count('timeout'),
      accuracy: exposures > 0 ? (correct + slow) / exposures : 0,
      bestStreak: this.bestStreak,
      durationMs: Math.round(performance.now() - this.startedAt),
      events: this.log.map((e) => ({
        senseId: e.prompt.target.senseId,
        roundKind: e.prompt.kind,
        wave: e.wave,
        promptOrd: e.ord,
        distractorIds: e.prompt.tiles.filter((d): d is TileDef => !!d && !d.correct).map((d) => d.word.senseId),
        responseSenseId: e.responseId,
        outcome: e.outcome,
        latencyMs: e.latencyMs,
      })),
    });
  }

  // ── Play ───────────────────────────────────────────────────────────────────

  private tileX(col: number) { return FORM_LEFT + this.marchDx + col * (TILE_W + TILE_GAP); }
  private rowBottom(i: number) { return this.frontY + this.offset - i * ROW_PITCH; }
  private colAt(x: number) {
    return Math.max(0, Math.min(COLS - 1, Math.floor((x - FORM_LEFT - this.marchDx + TILE_GAP / 2) / (TILE_W + TILE_GAP))));
  }

  private fire(): boolean {
    if (this.phase !== 'wave' || this.promptState !== 'live' || this.lostT > 0 || this.bullet) return false;
    this.bullet = { x: Math.round(this.cannonX), y: CANNON_TOP - 3 };
    if (this.audio) sfxFire();
    return true;
  }

  private record(outcome: Outcome, responseId: string | null) {
    const entry: Logged = {
      prompt: this.rows[0].prompt,
      outcome,
      latencyMs: Math.round(this.promptT * 1000),
      responseId,
      wave: this.wave,
      ord: this.promptOrd,
    };
    this.log.push(entry);
    this.waveLog.push(entry);
  }

  private hitTile(tile: LiveTile) {
    const { prompt } = this.rows[0];
    const x = this.tileX(tile.col);
    const y = this.rowBottom(0) - TILE_H;
    if (tile.def.correct) {
      // Latency is data: slower than SLOW_MS still scores, but isn't sent as a
      // promotion. Practice has no clock, so every correct answer counts.
      const fast = this.practice || this.promptT * 1000 <= SLOW_MS;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      const pts = promptPoints({ approachSec: this.approachSec, elapsedSec: this.promptT, streak: this.streak, ufo: prompt.kind === 'D', practice: this.practice });
      this.score += pts;
      this.record(fast ? 'correct' : 'correct_slow', tile.def.word.senseId);
      if (fast) this.o.onAnswer(prompt.target.senseId, true, answerMode(prompt));
      tile.state = 'hit';
      this.burstRect(x, y, TILE_W, TILE_H, [P.white, P.green, P.greenDark], 40);
      const mult = streakMultiplier(this.streak);
      this.float(x + TILE_W / 2, y + 14, `+${pts}${mult > 1 ? ` ×${mult}` : ''}`, P.amber);
      if (!fast) this.float(x + TILE_W / 2, y + 30, t('inv.slowCorrect'), P.silver);
      this.promptState = 'clear';
      this.stateT = 0;
      if (this.audio) {
        sfxCorrect();
        this.o.speak(prompt.target.english, 'en');
      }
    } else {
      this.streak = 0;
      this.record('wrong', tile.def.word.senseId);
      this.o.onAnswer(prompt.target.senseId, false, answerMode(prompt));
      this.misses.set(prompt.target.senseId, prompt.target);
      tile.state = 'wrong';
      this.revealWrong = true;
      this.promptState = 'reveal';
      this.stateT = 0;
      this.dropBomb(x + TILE_W / 2, y + TILE_H);
      if (this.audio) sfxWrong();
    }
  }

  /** The row reached the shield line unanswered: reveal the answer right there,
   *  above the cannon. The row slams into the nearest shield segment — or, with
   *  none left, the cannon goes when the row clears (collapse). */
  private timeout() {
    const row = this.rows[0];
    const { prompt } = row;
    this.streak = 0;
    this.record('timeout', null);
    this.o.onAnswer(prompt.target.senseId, false, answerMode(prompt));
    this.misses.set(prompt.target.senseId, prompt.target);
    this.revealWrong = false;
    this.breach = true;
    this.promptState = 'reveal';
    this.stateT = 0;
    const answer = row.tiles.find((x) => x?.def.correct);
    const seg = this.nearestShield(answer ? this.tileX(answer.col) + TILE_W / 2 : W / 2);
    if (seg >= 0) {
      // The row slams into the nearest standing bunker and blasts a big hole in it.
      const [a, z] = SHIELD_SEGS[seg];
      this.erode(Math.round((a + z) / 2), SHIELD_TOP, BREACH_CRATER);
      this.burstRect(a, SHIELD_TOP, z - a, SHIELD_ROWS, [P.white, P.cyan, P.cyanDim], 30);
    } else {
      this.breachCannon = true;
    }
    if (this.audio) sfxTimeout();
  }

  /** The front row is done. A correct answer pushes the formation back a row; a
   *  wrong shot closes the ranks so the ground stays lost; a row that reached the
   *  shields sends the formation back to the top. */
  private collapse(mode: 'gain' | 'close' | 'retreat') {
    const row = this.rows.shift()!;
    const y = this.rowBottom(0) - TILE_H;
    for (const tile of row.tiles) {
      if (tile && tile.state !== 'hit') this.burstRect(this.tileX(tile.col), y, TILE_W, TILE_H, [P.cyanDim, P.cyanDark], 8);
    }
    const newFront = mode === 'gain' ? Math.max(SPAWN_Y, this.frontY - ROW_PITCH) : mode === 'close' ? this.frontY : SPAWN_Y;
    this.offset = this.frontY + this.offset - ROW_PITCH - newFront;
    this.frontY = newFront;
    if (this.breachCannon) {
      this.breachCannon = false;
      if (this.loseCannon()) return;
    }
    if (this.rows.length === 0) this.endWave();
    else this.startPrompt();
  }

  /** A wrong shot's punishment: a fast bomb aimed at the nearest standing bunker. */
  private dropBomb(x: number, y: number) {
    const seg = this.nearestShield(x);
    // Somewhere along the bunker, not its middle — the middle is where a cannon
    // parked under that word sits, and one spot shouldn't take every hit.
    const tx = seg >= 0 ? SHIELD_SEGS[seg][0] + 8 + Math.random() * (SHIELD_SEGS[seg][1] - SHIELD_SEGS[seg][0] - 16) : x;
    this.bombs.push({ x, y, vx: (tx - x) / Math.max(0.1, (SHIELD_TOP - y) / BOMB_SPEED), vy: BOMB_SPEED, big: true });
  }

  /** The live row's ships bomb the cannon. An aimed bomb drops from the ship
   *  closest above the cannon and angles toward where the cannon is right now;
   *  the rest fall straight down from a random ship. */
  private dropShipBomb() {
    const row = this.rows[0];
    const bottom = this.rowBottom(0);
    if (!row || bottom < HUD_H + 12) return;
    const ships = row.tiles.filter((x): x is LiveTile => !!x && x.state === 'idle');
    if (ships.length === 0) return;
    const centre = (x: LiveTile) => this.tileX(x.col) + TILE_W / 2;
    const aimed = Math.random() < SHIP_BOMB_AIMED;
    const shooter = aimed
      ? ships.reduce((a, b) => (Math.abs(centre(a) - this.cannonX) <= Math.abs(centre(b) - this.cannonX) ? a : b))
      : ships[Math.floor(Math.random() * ships.length)];
    const x = Math.round(centre(shooter) + (Math.random() * 16 - 8));
    const y = bottom + 5;
    const fallSec = Math.max(0.2, (CANNON_TOP - y) / SHIP_BOMB_SPEED);
    const aimX = this.cannonX + (Math.random() * 2 - 1) * SHIP_BOMB_SPREAD;
    const vx = aimed ? Math.max(-SHIP_BOMB_MAX_DRIFT, Math.min(SHIP_BOMB_MAX_DRIFT, (aimX - x) / fallSec)) : 0;
    this.bombs.push({ x, y, vx, vy: SHIP_BOMB_SPEED, big: false });
    if (this.audio) sfxBombDrop();
  }

  private resetBunkers() {
    this.bunkers = SHIELD_SEGS.map(([a, b]) => {
      const w = b - a;
      const px = new Uint8Array(w * SHIELD_ROWS);
      for (let r = 0; r < SHIELD_ROWS; r++) {
        const inset = r === 0 ? 2 : r === 1 ? 1 : 0; // rounded top corners
        for (let c = inset; c < w - inset; c++) px[r * w + c] = 1;
      }
      return px;
    });
  }

  private bunkerLeft(i: number): number {
    const px = this.bunkers[i];
    let n = 0;
    for (let k = 0; k < px.length; k++) n += px[k];
    return px.length > 0 ? n / px.length : 0;
  }

  private checkShieldsDown() {
    if (SHIELD_SEGS.every((_, i) => this.bunkerLeft(i) < SHIELD_STANDING)) this.shieldsDown = true;
  }

  /** Blast a ragged crater out of whatever bunker pixels lie within r of (cx, cy). */
  private erode(cx: number, cy: number, r: number) {
    SHIELD_SEGS.forEach(([a, b], i) => {
      if (cx + r < a || cx - r >= b) return;
      const w = b - a;
      const px = this.bunkers[i];
      for (let row = 0; row < SHIELD_ROWS; row++) {
        for (let c = 0; c < w; c++) {
          const dx = a + c - cx;
          const dy = SHIELD_TOP + row - cy;
          if (dx * dx + dy * dy <= (r - Math.random() * 0.9) ** 2) px[row * w + c] = 0;
        }
      }
    });
    this.burstRect(cx - 2, cy - 1, 4, 3, [P.white, P.cyan, P.cyanDim], 6 + r * 2);
    this.checkShieldsDown();
  }

  /** The bunker row a bomb at (x, tip) has run into, or -1 if its column is open. */
  private bunkerHit(x: number, tip: number): number {
    const seg = SHIELD_SEGS.findIndex(([a, b]) => x >= a && x < b);
    if (seg < 0 || tip < SHIELD_TOP) return -1;
    const [a, b] = SHIELD_SEGS[seg];
    const w = b - a;
    const deepest = Math.min(SHIELD_ROWS - 1, Math.floor(tip - SHIELD_TOP));
    for (let row = 0; row <= deepest; row++) {
      if (this.bunkers[seg][row * w + (x - a)]) return row;
    }
    return -1;
  }

  /** Shield pixels standing over a cannon parked at x (its 13px width, all rows). */
  private coverAt(x: number): number {
    let n = 0;
    for (let cx = x - 6; cx <= x + 6; cx++) {
      const seg = SHIELD_SEGS.findIndex(([a, b]) => cx >= a && cx < b);
      if (seg < 0) continue;
      const [a, b] = SHIELD_SEGS[seg];
      for (let r = 0; r < SHIELD_ROWS; r++) n += this.bunkers[seg][r * (b - a) + (cx - a)];
    }
    return n;
  }

  /** The best-covered cannon position, preferring ones near `from` on ties. */
  private bestCoverX(from: number): number {
    let best = from;
    let bestN = -1;
    for (let x = 10; x <= W - 10; x++) {
      const n = this.coverAt(x) * 1000 - Math.abs(x - from);
      if (n > bestN) {
        bestN = n;
        best = x;
      }
    }
    return best;
  }

  private nearestShield(x: number): number {
    let best = -1;
    let bestD = Infinity;
    SHIELD_SEGS.forEach(([a, b], i) => {
      const d = Math.abs((a + b) / 2 - x);
      if (this.bunkerLeft(i) >= SHIELD_STANDING && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  /** Returns true when that was the last cannon (the session is over). */
  private loseCannon(): boolean {
    this.cannons--;
    this.burstRect(this.cannonX - 6, CANNON_TOP, 13, 8, [P.white, P.amber, P.red, P.amberDark], 36);
    this.shakeT = 0.35;
    this.bullet = null;
    this.bombs = [];
    if (this.audio) sfxExplosion();
    if (this.cannons <= 0) {
      this.gameOver = true;
      this.clearSaucer();
      this.promptState = 'idle';
      this.o.onLive(null);
      this.float(W / 2, 110, t('inv.gameOver'), P.red);
      this.afterWave();
      return true;
    }
    this.float(W / 2, SHIELD_Y - 20, t('inv.cannonLost'), P.red);
    this.lostT = LOST_SEC;
    this.bombT = SHIP_BOMB_GRACE - 0.5; // a fresh cannon gets a moment before the bombing resumes
    // …and rolls in under the best cover left (not just the nearest bunker, whose
    // middle may be drilled out), so one open hole can't take every cannon in a row.
    this.cannonX = this.bestCoverX(this.cannonX);
    this.seekX = null;
    this.fireOnArrive = false;
    return false;
  }

  private spawnSaucer(kind: Saucer['kind']) {
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    this.saucer = {
      x: dir === 1 ? -16 : W,
      dir,
      kind,
      stop: this.audio && kind === 'ufo' ? sfxUfo() : () => {},
    };
  }

  private clearSaucer() {
    this.saucer?.stop();
    this.saucer = null;
  }

  private findPineapple() {
    const s = this.saucer!;
    this.burstRect(s.x, SAUCER_Y - 3, 16, 10, [P.white, P.green, P.greenDark], 30);
    this.clearSaucer();
    this.o.onPineapple();
  }

  private hitUfo() {
    const s = this.saucer!;
    this.burstRect(s.x, SAUCER_Y, 16, 7, [P.white, P.magenta, P.navy], 30);
    const options: PowerUp[] = ['slow', 'scan'];
    if (this.audio) options.push('echo');
    this.capsule = { x: s.x + 8, y: SAUCER_Y + 8, kind: options[Math.floor(Math.random() * options.length)] };
    this.clearSaucer();
  }

  private collect(kind: PowerUp) {
    if (this.audio) sfxPowerUp();
    const row = this.rows[0];
    // Say what it does, not just its name — and long enough to read.
    const note = (k: PowerUp) => this.float(this.cannonX, NOTE_Y, t(POWER_NOTE[k]), P.cyan, NOTE_SEC);
    if (kind === 'slow') {
      this.slowT = SLOW_SEC;
      note('slow');
    } else if (kind === 'echo' && row && row.prompt.style !== 'B') {
      const p = row.prompt;
      this.o.speak(promptText(p, this.o.language), p.style === 'A' ? this.o.language : 'en');
      note('echo');
    } else {
      // SCAN — or an ECHO with nothing to say (a picture round). It usually lands
      // after the word it was shot on is answered, so say when it will act.
      if (row && this.promptState === 'live') {
        this.applyScan(row);
        note('scan');
      } else {
        this.scanPending = true;
        this.float(this.cannonX, NOTE_Y, t('inv.scanNextNote'), P.cyan, NOTE_SEC);
      }
    }
  }

  /** SCAN takes up to two wrong answers out of the row — they fizzle to an empty
   *  outline and shots pass through — but always leaves one wrong answer standing,
   *  so a three-word UFO round still asks a question. */
  private applyScan(row: Row) {
    const wrong = row.tiles.filter((x): x is LiveTile => !!x && !x.def.correct && x.state === 'idle');
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
    }
    const top = this.rowBottom(0) - TILE_H;
    wrong.slice(0, Math.min(2, wrong.length - 1)).forEach((x) => {
      x.state = 'scanned';
      this.burstRect(this.tileX(x.col), top, TILE_W, TILE_H, [P.white, P.cyan, P.cyanDim], 20);
    });
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  update(dt: number) {
    if (this.hold) return;
    this.time += dt;
    this.phaseT += dt;
    this.updateEffects(dt);
    switch (this.phase) {
      case 'attract':
        this.updateMarch(dt, 0.5);
        break;
      case 'brief':
        this.easeOffset(dt, 3);
        this.updateMarch(dt, 0.5);
        if (this.phaseT >= BRIEF_SEC) this.beginWave();
        break;
      case 'wave':
        this.updateWave(dt);
        break;
      case 'waveClear':
        if (this.phaseT >= WAVE_CLEAR_SEC) this.afterWave();
        break;
      case 'report':
        if (this.phaseT >= REPORT_ITEM_SEC) this.nextReportItem();
        break;
      case 'final':
        if (this.phaseT >= 15) this.finish();
        break;
    }
  }

  private updateEffects(dt: number) {
    if (!this.o.reducedMotion) {
      for (const s of this.stars) {
        s.y += s.s * dt;
        if (s.y >= H) { s.y -= H; s.x = Math.random() * W; }
      }
    }
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < f.life);
    this.shakeT = Math.max(0, this.shakeT - dt);
  }

  private easeOffset(dt: number, rate = 10) {
    this.offset += -this.offset * Math.min(1, dt * rate);
    if (Math.abs(this.offset) < 0.3) this.offset = 0;
  }

  private updateMarch(dt: number, interval: number) {
    this.marchT += dt;
    if (this.marchT < interval) return;
    this.marchT = 0;
    this.marchFrame ^= 1;
    if (!this.o.reducedMotion) {
      this.marchDx += this.marchDir;
      if (Math.abs(this.marchDx) >= MARCH_RANGE) this.marchDir = -this.marchDir;
    }
    if (this.audio && this.phase === 'wave') sfxMarch(this.marchStep++);
  }

  private updateWave(dt: number) {
    this.updateCannon(dt);
    this.easeOffset(dt);
    this.updateMarch(dt, Math.max(0.28, 0.62 - (this.descentSpeed - 10) * 0.02) * (this.slowT > 0 ? 1.6 : 1));
    this.slowT = Math.max(0, this.slowT - dt);
    this.updateBullet(dt);
    this.updateBombs(dt);
    this.updateSaucer(dt);

    if (this.lostT > 0) {
      this.lostT -= dt;
      return; // formation and clock hold while a fresh cannon rolls in
    }

    switch (this.promptState) {
      case 'live':
        this.promptT += dt;
        // The words only move while a prompt is live, and the answer waits until
        // they're right on top of the cannon.
        if (!this.practice) {
          this.bombT -= dt * (this.slowT > 0 ? 0.5 : 1);
          if (this.bombT <= 0) {
            const tier = [2, 5, 8, 11].filter((w) => this.wave > w).length;
            this.bombT = SHIP_BOMB_EVERY[tier] * (0.7 + Math.random() * 0.6);
            if (this.bombs.filter((b) => !b.big).length < SHIP_BOMB_MAX) this.dropShipBomb();
          }
          const speed = this.descentSpeed * (this.shieldsDown ? SHIELDS_DOWN_MULT : 1) * (this.slowT > 0 ? 0.5 : 1);
          this.frontY = Math.min(SHIELD_Y, this.frontY + speed * dt);
          if (this.frontY >= SHIELD_Y) this.timeout();
        }
        break;
      case 'reveal':
        this.stateT += dt;
        if (this.stateT >= (this.revealWrong ? SHAKE_SEC : 0) + PULSE_SEC) this.collapse(this.breach ? 'retreat' : 'close');
        break;
      case 'clear':
        this.stateT += dt;
        if (this.stateT >= CLEAR_SEC) this.collapse('gain');
        break;
    }
  }

  private updateCannon(dt: number) {
    const dir = (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0) || this.padAxis;
    if (dir !== 0) {
      this.cannonX += dir * CANNON_SPEED * dt;
      this.seekX = null;
      this.fireOnArrive = false;
    } else if (this.seekX !== null) {
      const step = SEEK_SPEED * dt;
      const d = this.seekX - this.cannonX;
      if (Math.abs(d) <= step) {
        this.cannonX = this.seekX;
        if (!this.drag) this.seekX = null;
      } else {
        this.cannonX += Math.sign(d) * step;
      }
    }
    this.cannonX = Math.max(7, Math.min(W - 7, this.cannonX));
    if (this.fireOnArrive && this.seekX === null) {
      // Wait out a bullet still in flight, briefly, rather than dropping the tap.
      this.fireWaitT += dt;
      if (this.fire() || this.fireWaitT > 0.8) this.fireOnArrive = false;
    }
  }

  private updateBullet(dt: number) {
    const b = this.bullet;
    if (!b) return;
    b.y -= BULLET_SPEED * dt;
    const row = this.rows[0];
    if (row && this.promptState === 'live' && this.lostT <= 0) {
      const bottom = this.rowBottom(0);
      if (b.y <= bottom && b.y + 4 >= bottom - TILE_H) {
        for (const tile of row.tiles) {
          if (!tile || tile.state !== 'idle') continue;
          const x = this.tileX(tile.col);
          if (b.x >= x && b.x < x + TILE_W) {
            this.bullet = null;
            this.hitTile(tile);
            return;
          }
        }
      }
    }
    const s = this.saucer;
    if (s && b.x >= s.x && b.x < s.x + 16 && b.y <= SAUCER_Y + 7 && b.y + 4 >= SAUCER_Y - 3) {
      this.bullet = null;
      if (s.kind === 'pineapple') this.findPineapple();
      else this.hitUfo();
      return;
    }
    if (b.y < HUD_H) this.bullet = null;
  }

  private updateBombs(dt: number) {
    const flying: Bomb[] = [];
    let cannonHit = false;
    for (const b of this.bombs) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const x = Math.round(b.x);
      const row = this.bunkerHit(x, b.y);
      if (row >= 0) {
        // Shields take the hit; each bomb bites a crater out of them.
        this.erode(x, SHIELD_TOP + row, b.big ? WRONG_BOMB_CRATER : SHIP_BOMB_CRATER);
        if (this.audio) sfxShieldHit();
        continue;
      }
      if (b.y >= CANNON_TOP + 1 && b.y < CANNON_TOP + 9 && Math.abs(x - this.cannonX) <= 6 && this.lostT <= 0 && !this.gameOver && !this.practice) {
        cannonHit = true; // through a gap or a blasted hole
        continue;
      }
      if (b.y < BAR_Y) flying.push(b);
    }
    this.bombs = flying;
    if (cannonHit && this.phase === 'wave') this.loseCannon();
  }

  private updateSaucer(dt: number) {
    const s = this.saucer;
    if (s) {
      s.x += s.dir * (s.kind === 'ufo' ? UFO_SPEED : PINEAPPLE_SPEED) * dt;
      if (s.x < -20 || s.x > W + 4) this.clearSaucer();
    }
    const c = this.capsule;
    if (c) {
      c.y += 70 * dt;
      c.x += (this.cannonX - c.x) * Math.min(1, dt * 2);
      if (c.y >= CANNON_TOP) {
        this.capsule = null;
        this.collect(c.kind);
      }
    }
  }

  private burstRect(x: number, y: number, w: number, h: number, colors: readonly string[], n: number) {
    if (this.o.reducedMotion) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const edge = Math.random() < 0.5;
      const px = x + (edge ? (Math.random() < 0.5 ? 0 : w) : Math.random() * w);
      const py = y + (edge ? Math.random() * h : (Math.random() < 0.5 ? 0 : h));
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 60;
      const life = 0.4 + Math.random() * 0.6;
      this.particles.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life, max: life, colors });
    }
  }

  private float(x: number, y: number, text: string, color: string, life = 1) {
    const half = measure(text) / 2 + 2;
    this.floaters.push({ x: Math.max(half, Math.min(W - half, x)), y, text, color, t: 0, life });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = P.black;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (this.shakeT > 0 && !this.o.reducedMotion) {
      ctx.translate(Math.round(Math.sin(this.time * 90) * 2), Math.round(Math.cos(this.time * 70)));
    }
    for (const s of this.stars) {
      ctx.fillStyle = s.c;
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1);
    }
    if (this.phase === 'attract') {
      this.drawAttract(ctx);
    } else {
      this.drawPlayfield(ctx);
      this.drawHud(ctx);
      this.drawBar(ctx);
      this.drawAirborne(ctx);
      if (this.phase === 'brief') this.drawBrief(ctx);
      if (this.phase === 'waveClear') this.drawWaveClear(ctx);
      if (this.phase === 'report') this.drawReport(ctx);
      if (this.phase === 'final') this.drawFinal(ctx);
    }
    ctx.restore();
  }

  private drawPlayfield(ctx: CanvasRenderingContext2D) {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const bottom = this.rowBottom(i);
      if (bottom <= HUD_H) continue;
      for (const tile of this.rows[i].tiles) {
        if (tile) this.drawTile(ctx, tile, this.tileX(tile.col), bottom - TILE_H, i === 0 && this.phase === 'wave', this.rows[i].prompt.kind === 'D', this.rows[i].hull);
      }
    }
    const frame = Math.floor(this.time * 8) % 2;
    for (const b of this.bombs) sprite(ctx, BOMB_ART[frame], Math.round(b.x) - 1, Math.round(b.y) - 5, b.big ? P.red : P.amberPale);
    if (this.bullet) {
      ctx.fillStyle = P.amberPale;
      ctx.fillRect(this.bullet.x, Math.round(this.bullet.y), 1, 4);
    }
    this.drawShields(ctx);
    // A fresh cannon blinks in at 2 Hz — nothing on screen flashes faster than 3 Hz.
    if (!this.gameOver && (this.lostT <= 0 || Math.floor(this.lostT * 4) % 2 === 0)) {
      sprite(ctx, CANNON_ART, Math.round(this.cannonX) - 6, CANNON_TOP, P.amber);
    }
    if (this.phase === 'wave') {
      if (this.shieldsDown) drawText(ctx, t('inv.shieldsDown'), W - 3, SHIELD_Y - 13, P.red, 1, 'right');
      if (this.slowT > 0) drawText(ctx, `${t('inv.slow')} ${Math.ceil(this.slowT)}`, 3, SHIELD_Y - 13, P.cyan);
    }
  }

  /** Saucers, power-ups, debris and score floats ride above the HUD band — the
   *  front row sits right under it, so its floats would otherwise vanish. */
  private drawAirborne(ctx: CanvasRenderingContext2D) {
    this.drawSaucer(ctx);
    if (this.capsule) {
      const label = t(POWER_LABEL[this.capsule.kind]);
      const w = measure(label) + 4;
      const x = Math.round(this.capsule.x - w / 2);
      const y = Math.round(this.capsule.y);
      ctx.fillStyle = P.night;
      ctx.fillRect(x, y, w, 11);
      this.outline(ctx, x, y, w, 11, P.cyan);
      drawText(ctx, label, x + 2, y, P.cyan);
    }
    for (const p of this.particles) {
      ctx.fillStyle = p.colors[Math.min(p.colors.length - 1, Math.floor((1 - p.life / p.max) * p.colors.length))];
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1);
    }
    for (const f of this.floaters) drawText(ctx, f.text, f.x, Math.max(HUD_H, f.y - 6 - (f.t / f.life) * 18), f.color, 1, 'center');
  }

  private outline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: LiveTile, tx: number, ty: number, live: boolean, ufo: boolean, hullIndex: number) {
    if (tile.state === 'hit') return;
    if (tile.state === 'scanned') {
      // Removed by SCAN: just a dotted ghost of where the word was.
      const gx = Math.round(tx);
      const gy = Math.round(ty);
      ctx.fillStyle = P.cyanDark;
      for (let i = 0; i < TILE_W; i += 3) {
        ctx.fillRect(gx + i, gy, 1, 1);
        ctx.fillRect(gx + i, gy + TILE_H - 1, 1, 1);
      }
      for (let i = 0; i < TILE_H; i += 3) {
        ctx.fillRect(gx, gy + i, 1, 1);
        ctx.fillRect(gx + TILE_W - 1, gy + i, 1, 1);
      }
      return;
    }
    const reveal = live && this.promptState === 'reveal';
    const shaking = reveal && tile.state === 'wrong' && this.stateT < SHAKE_SEC && !this.o.reducedMotion;
    const x = Math.round(tx) + (shaking ? (Math.floor(this.stateT * 30) % 2 === 0 ? -2 : 2) : 0);
    const y = Math.round(ty);
    // The answer is never withheld: after a miss the right tile swells amber once.
    const pulseStart = this.revealWrong ? SHAKE_SEC : 0;
    const glow = reveal && tile.def.correct && this.stateT >= pulseStart
      ? Math.sin(Math.min(1, (this.stateT - pulseStart) / PULSE_SEC) * Math.PI)
      : 0;

    const wrong = live && tile.state === 'wrong';
    let hull = wrong ? WRONG_HULL : ufo ? UFO_HULL : HULLS[hullIndex % HULLS.length];
    let screen = SCREEN;
    let ink: string = wrong ? P.grey : P.white;
    if (glow > 0) {
      hull = { body: P.amber, shade: P.amberDark, edge: P.amberPale, dome: P.amberPale };
      screen = glow > 0.6 ? P.amber : glow > 0.25 ? P.amberDark : SCREEN;
      ink = glow > 0.6 ? P.black : P.white;
    }

    const W_ = TILE_W;
    const H_ = TILE_H;
    const f = this.marchFrame;
    const cx = x + W_ / 2;
    const twoLines = tile.def.lines.length === 2;
    // Rows behind the live one ride dimmed, so the row you're answering pops.
    ctx.save();
    if (!live) ctx.globalAlpha = 0.45;

    // Hull: gold outline with clipped corners, coloured body, darker belly band.
    ctx.fillStyle = hull.edge;
    ctx.fillRect(x + 1, y, W_ - 2, H_);
    ctx.fillRect(x, y + 1, W_, H_ - 2);
    ctx.fillStyle = hull.body;
    ctx.fillRect(x + 2, y + 1, W_ - 4, H_ - 2);
    ctx.fillRect(x + 1, y + 2, W_ - 2, H_ - 4);
    ctx.fillStyle = hull.shade;
    ctx.fillRect(x + 2, y + H_ - 5, W_ - 4, 3);

    // Cockpit dome in the gap above, with eyes that glance side to side.
    ctx.fillStyle = hull.dome;
    ctx.fillRect(cx - 3, y - 3, 6, 1);
    ctx.fillRect(cx - 5, y - 2, 10, 1);
    ctx.fillRect(cx - 7, y - 1, 14, 1);
    ctx.fillStyle = P.black;
    ctx.fillRect(cx - 3 + f, y - 2, 1, 1);
    ctx.fillRect(cx + 2 + f, y - 2, 1, 1);

    // Claws in the side gaps, stepping with the march.
    ctx.fillStyle = hull.edge;
    const clawRows = f ? [11, 12] : [7, 16];
    for (const r of clawRows) {
      ctx.fillRect(x - 1, y + r, 1, 1);
      ctx.fillRect(x + W_, y + r, 1, 1);
    }

    // The word's screen: dark (or glowing) panel so the text stays readable.
    const sy = twoLines ? y + 1 : y + 3;
    const sh = twoLines ? H_ - 2 : H_ - 9;
    ctx.fillStyle = screen;
    ctx.fillRect(x + 4, sy, W_ - 8, sh);
    ctx.fillRect(x + 3, sy + 1, W_ - 6, sh - 2);

    // Running lights along the belly, alternating with the march (≤ 2 Hz).
    if (!twoLines) {
      for (let i = 0, lx = x + 6; lx < x + W_ - 6; i++, lx += 7) {
        ctx.fillStyle = (i + f) % 2 === 0 ? P.white : hull.edge;
        ctx.fillRect(lx, y + H_ - 4, 2, 1);
      }
    }

    if (wrong) {
      // Wrong is marked by shape as well as colour: struck corners on the screen.
      ctx.fillStyle = P.red;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 4 + i, sy + 1 + i, 1, 1);
        ctx.fillRect(x + W_ - 5 - i, sy + 1 + i, 1, 1);
        ctx.fillRect(x + 4 + i, sy + sh - 2 - i, 1, 1);
        ctx.fillRect(x + W_ - 5 - i, sy + sh - 2 - i, 1, 1);
      }
    }

    const lines = tile.def.lines;
    if (lines.length === 1) drawText(ctx, lines[0], cx, y + 5, ink, 1, 'center');
    else lines.forEach((line, i) => drawText(ctx, line, cx, y + 1 + i * 11, ink, 1, 'center'));
    ctx.restore();
    if (glow > 0) drawText(ctx, '▲', cx, y + H_ + 1, P.amber, 1, 'center');
  }

  private drawSaucer(ctx: CanvasRenderingContext2D) {
    const s = this.saucer;
    if (!s) return;
    const x = Math.round(s.x);
    const color = s.kind === 'ufo' ? P.magenta : P.green;
    sprite(ctx, SAUCER_ART, x, SAUCER_Y, color);
    // Running lights alternate at 1.5 Hz.
    ctx.fillStyle = P.black;
    const phase = Math.floor(this.time * 3) % 2;
    for (let c = phase; c < 16; c += 2) ctx.fillRect(x + c, SAUCER_Y + 4, 1, 1);
    if (s.kind === 'pineapple') {
      // The alien pineapple rides in the dome, crown poking out the top.
      ctx.fillStyle = P.amber;
      ctx.fillRect(x + 6, SAUCER_Y + 1, 4, 1);
      ctx.fillStyle = P.green;
      ctx.fillRect(x + 7, SAUCER_Y - 1, 2, 1);
      ctx.fillRect(x + 6, SAUCER_Y - 2, 1, 1);
      ctx.fillRect(x + 9, SAUCER_Y - 2, 1, 1);
      ctx.fillRect(x + 7, SAUCER_Y - 3, 1, 1);
    }
  }

  private drawShields(ctx: CanvasRenderingContext2D) {
    SHIELD_SEGS.forEach(([a, b], i) => {
      const w = b - a;
      const px = this.bunkers[i];
      for (let row = 0; row < SHIELD_ROWS; row++) {
        ctx.fillStyle = row < 3 ? P.cyan : P.cyanDim;
        // Runs of standing pixels, so a ragged bunker is a handful of rects.
        let start = -1;
        for (let c = 0; c <= w; c++) {
          const on = c < w && px[row * w + c] === 1;
          if (on && start < 0) start = c;
          if (!on && start >= 0) {
            ctx.fillRect(a + start, SHIELD_TOP + row, c - start, 1);
            start = -1;
          }
        }
      }
    });
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = P.black;
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = P.cyanDark;
    ctx.fillRect(0, HUD_H - 1, W, 1);
    const label = t('inv.score');
    drawText(ctx, label, 2, 0, P.amber);
    drawText(ctx, pad6(this.score), 6 + measure(label), 0, P.white);
    const count = this.phase === 'wave' ? `  ${this.o.promptsPerWave - this.rows.length + 1}/${this.o.promptsPerWave}` : '';
    const center = `${t('inv.wave', { n: this.wave, total: this.o.waves })}${count}${this.practice ? ` · ${t('inv.practiceLabel')}` : ''}`;
    drawText(ctx, center, W / 2, 0, P.silver, 1, 'center');
    for (let i = 0; i < this.cannons; i++) sprite(ctx, CANNON_ART, W - 15 - i * 15, 1, P.amber);
    const mult = streakMultiplier(this.streak);
    if (mult > 1) drawText(ctx, `×${mult}`, W - 4 - this.cannons * 15, 0, P.amber, 1, 'right');
  }

  private drawBar(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = P.night;
    ctx.fillRect(0, BAR_Y, W, H - BAR_Y);
    ctx.fillStyle = P.cyanDim;
    ctx.fillRect(0, BAR_Y, W, 1);
    const row = this.rows[0];
    if (this.phase !== 'wave' || !row) return;
    const p = row.prompt;
    drawText(ctx, t(ROUND_LABEL[p.kind]), 3, BAR_Y + 2, p.kind === 'D' ? P.amber : P.cyanDim);
    if (p.style === 'B') {
      const pic = this.pictures.get(p.target.senseId);
      if (pic) {
        this.drawPicture(ctx, pic, W / 2 - 16, BAR_Y + 2, 32);
        this.outline(ctx, W / 2 - 17, BAR_Y + 1, 34, 34, P.cyanDim);
      }
    } else {
      const text = promptText(p, this.o.language);
      if (measure(text) * 2 <= 250) {
        drawText(ctx, text, W / 2, BAR_Y + 6, P.amberPale, 2, 'center');
      } else {
        const lines = fitLines(text, 250) ?? [text];
        lines.forEach((line, i) => drawText(ctx, line, W / 2, BAR_Y + (lines.length === 1 ? 11 : 6 + i * 12), P.amberPale, 1, 'center'));
      }
    }
    if (!this.practice && this.promptState === 'live') {
      // How much room is left before the words reach the shields.
      const frac = Math.max(0, Math.min(1, (SHIELD_Y - this.frontY) / (SHIELD_Y - SPAWN_Y)));
      ctx.fillStyle = frac < 0.25 ? P.amberPale : P.amber;
      ctx.fillRect(3, H - 3, Math.round((W - 6) * frac), 2);
    }
  }

  private drawPicture(ctx: CanvasRenderingContext2D, pic: CanvasImageSource, x: number, y: number, size: number) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic, x, y, size, size);
    ctx.imageSmoothingEnabled = false;
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, edge: string) {
    ctx.fillStyle = P.black;
    ctx.fillRect(x, y, w, h);
    this.outline(ctx, x, y, w, h, edge);
  }

  private drawBrief(ctx: CanvasRenderingContext2D) {
    const title = t('inv.wave', { n: this.wave, total: this.o.waves });
    const label = t(ROUND_LABEL[this.waveStyle]);
    const line = t(BRIEF_LINE[this.waveStyle]);
    const info = this.practice ? t('inv.noClock') : t('inv.waveInfo', { n: this.o.promptsPerWave });
    // Translations run long (Spanish especially), so the box grows to fit its text.
    const w = Math.min(W - 8, Math.max(240, measure(line) + 16, measure(info) + 16));
    this.panel(ctx, Math.round((W - w) / 2), 70, w, 92, P.cyanDim);
    drawText(ctx, title, W / 2, 76, P.amber, fitScale([title], w - 12, 3), 'center');
    drawText(ctx, label, W / 2, 110, P.cyan, fitScale([label], w - 12, 2), 'center');
    drawText(ctx, line, W / 2, 134, P.white, 1, 'center');
    drawText(ctx, info, W / 2, 147, P.silver, 1, 'center');
  }

  private drawWaveClear(ctx: CanvasRenderingContext2D) {
    this.panel(ctx, 40, 80, 240, this.perfect ? 72 : 48, P.greenDark);
    const title = t('inv.waveClear');
    drawText(ctx, title, W / 2, 88, P.green, fitScale([title], 230, 3), 'center');
    if (this.perfect) {
      drawText(ctx, t('inv.perfect', { bonus: PERFECT_BONUS }), W / 2, 122, P.amber, 1, 'center');
      drawText(ctx, t('inv.shieldsRepaired'), W / 2, 136, P.cyan, 1, 'center');
    }
  }

  private drawReport(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = P.black;
    ctx.fillRect(0, HUD_H, W, H - HUD_H);
    const w = this.reportItems[this.reportIdx];
    if (!w) return;
    drawText(ctx, t('inv.report', { n: this.wave }), W / 2, 14, P.amber, 2, 'center');
    drawText(ctx, t('inv.reportMissed', { i: this.reportIdx + 1, n: this.reportItems.length }), W / 2, 38, P.silver, 1, 'center');
    // Every missed item as native word, English, and picture together.
    const pic = this.pictures.get(w.senseId);
    let y = 52;
    if (pic) {
      this.drawPicture(ctx, pic, W / 2 - 32, y, 64);
      this.outline(ctx, W / 2 - 33, y - 1, 66, 66, P.cyanDim);
      y += 70;
    } else {
      y += 16;
    }
    const native = nativeOf(w, this.o.language);
    if (native) {
      const lines = fitLines(native, 300) ?? [native];
      const s = fitScale(lines, 300, 2);
      lines.forEach((line, i) => drawText(ctx, line, W / 2, y + i * 11 * s, P.white, s, 'center'));
      y += lines.length * 11 * s + 2;
      drawText(ctx, t('inv.inEnglish'), W / 2, y, P.grey, 1, 'center');
      y += 12;
    }
    const english = fitLines(w.english, 300) ?? [w.english];
    const es = fitScale(english, 300, 2);
    english.forEach((line, i) => drawText(ctx, line, W / 2, y + i * 11 * es, P.green, es, 'center'));
    const frac = Math.min(1, this.phaseT / REPORT_ITEM_SEC);
    ctx.fillStyle = P.cyanDark;
    ctx.fillRect(60, 214, 200, 2);
    ctx.fillStyle = P.amber;
    ctx.fillRect(60, 214, Math.round(200 * frac), 2);
    drawText(ctx, t('inv.reportHint'), W / 2, 230, P.grey, 1, 'center');
  }

  private drawFinal(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = P.black;
    ctx.fillRect(0, HUD_H, W, H - HUD_H);
    const title = this.gameOver ? t('inv.gameOver') : t('inv.sessionComplete');
    drawText(ctx, title, W / 2, 34, this.gameOver ? P.red : P.green, fitScale([title], 300, 3), 'center');
    drawText(ctx, t('inv.score'), W / 2, 76, P.amber, 1, 'center');
    drawText(ctx, pad6(this.score), W / 2, 88, P.white, 3, 'center');
    if (!this.practice && this.score > this.best && this.score > 0) {
      drawText(ctx, t('inv.newHiScore'), W / 2, 124, P.amber, 1, 'center');
    }
    const exposures = this.log.length;
    const right = this.log.filter((e) => e.outcome === 'correct' || e.outcome === 'correct_slow').length;
    const pct = exposures > 0 ? Math.round((right / exposures) * 100) : 0;
    drawText(ctx, t('inv.accuracy', { pct }), W / 2, 144, P.silver, 1, 'center');
    drawText(ctx, t('inv.exposures', { n: exposures }), W / 2, 157, P.silver, 1, 'center');
    drawText(ctx, t('inv.bestStreak', { n: this.bestStreak }), W / 2, 170, P.silver, 1, 'center');
    if (this.phaseT > 1 && Math.floor(this.phaseT * 2) % 2 === 0) {
      drawText(ctx, t('inv.continue'), W / 2, 214, P.cyan, 1, 'center');
    }
  }

  private drawAttract(ctx: CanvasRenderingContext2D) {
    const title = t('inv.title');
    const words = title.split(' ');
    const lines = words.length > 1 && fitScale(words, 300, 3) === 3
      ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
      : [title];
    const ts = fitScale(lines, 300, 3);
    lines.forEach((line, i) => drawText(ctx, line, W / 2, 20 + i * 34, i === 0 ? P.amber : P.cyan, ts, 'center'));

    this.demo.forEach((tile) => {
      if (tile) this.drawTile(ctx, tile, this.tileX(tile.col), 96, true, false, tile.col);
    });

    drawText(ctx, `${t('inv.hiScore')} ${pad6(this.best)}`, W / 2, 132, P.amberPale, 1, 'center');
    // START pulses once a second, the cabinet's INSERT COIN.
    const on = Math.floor(this.time * 2) % 2 === 0;
    this.panel(ctx, START_BTN.x, START_BTN.y, START_BTN.w, START_BTN.h, on ? P.amber : P.amberDark);
    drawText(ctx, t('inv.start'), W / 2, START_BTN.y + 3, on ? P.amber : P.amberPale, 1, 'center');
    this.panel(ctx, PRACTICE_BTN.x, PRACTICE_BTN.y, PRACTICE_BTN.w, PRACTICE_BTN.h, P.cyanDim);
    drawText(ctx, t('inv.practice'), W / 2, PRACTICE_BTN.y + 3, P.cyan, 1, 'center');
    drawText(ctx, t('inv.controls'), W / 2, 202, P.grey, 1, 'center');
    drawText(ctx, t('inv.controlsTouch'), W / 2, 215, P.grey, 1, 'center');
  }
}
