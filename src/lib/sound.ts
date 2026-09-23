// Short UI sound effects (distinct from TTS in speech.ts). Volume tracks the
// shared volume slider via getVolume(); callers gate on the audio toggle.
import { getVolume } from './speech';

const CORRECT_URL = 'https://utfs.io/f/7s4iMGegdw5Aou8QaiYxmjLH94RiP1DSnAyMGTfYh6O5aIB8';
const VICTORY_URL = 'https://utfs.io/f/7s4iMGegdw5ANBXGKAQ0vTybNaYtm3p4DqxnFLPh27wBMsRW';

// One reusable element per sound — primed at load so the first play is snappy
// (the browser caches the file; a fresh currentTime=0 restarts on replay).
function make(url: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  const a = new Audio(url);
  a.preload = 'auto';
  return a;
}

const correctEl = make(CORRECT_URL);
const victoryEl = make(VICTORY_URL);

function play(el: HTMLAudioElement | null) {
  if (!el) return;
  try {
    el.currentTime = 0;
    el.volume = getVolume();
    void el.play().catch(() => { /* autoplay/network errors are non-fatal */ });
  } catch {
    /* non-fatal */
  }
}

// Correct sound — after each completed exercise.
export function playCorrect() {
  play(correctEl);
}

// Victory trumpet — on lesson completion.
export function playVictory() {
  play(victoryEl);
}

// ── Arcade synth (Space Invaders) ─────────────────────────────────────────
// WebAudio blips, generated rather than downloaded: fire, correct, wrong, wave
// clear, explosion, the UFO warble and the march bass. Callers gate on the audio
// toggle; the AudioContext is created on the first user gesture (unlockArcadeAudio).

let ac: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function unlockArcadeAudio() {
  if (typeof window === 'undefined') return;
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') void ac.resume();
  } catch {
    ac = null;
  }
}

function out(gain: number): { ctx: AudioContext; node: GainNode } | null {
  if (!ac || ac.state !== 'running') return null;
  const node = ac.createGain();
  node.gain.value = gain * getVolume();
  node.connect(ac.destination);
  return { ctx: ac, node };
}

function tone(type: OscillatorType, from: number, to: number, start: number, dur: number, gain: number) {
  const o = out(gain);
  if (!o) return;
  const t0 = o.ctx.currentTime + start;
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  o.node.gain.setValueAtTime(o.node.gain.value, t0);
  o.node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(o.node);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseSweep(fromHz: number, toHz: number, dur: number, gain: number) {
  const o = out(gain);
  if (!o) return;
  if (!noise) {
    noise = o.ctx.createBuffer(1, o.ctx.sampleRate, o.ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = o.ctx.currentTime;
  const src = o.ctx.createBufferSource();
  src.buffer = noise;
  const filter = o.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(fromHz, t0);
  filter.frequency.exponentialRampToValueAtTime(toHz, t0 + dur);
  o.node.gain.setValueAtTime(o.node.gain.value, t0);
  o.node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(o.node);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** 120 ms square blip. */
export function sfxFire() { tone('square', 880, 440, 0, 0.12, 0.12); }

/** Rising arpeggio. */
export function sfxCorrect() {
  [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, i * 0.06, 0.09, 0.1));
}

/** Descending noise sweep. */
export function sfxWrong() { noiseSweep(2400, 180, 0.42, 0.5); }

/** The clock ran out — a low two-note droop. */
export function sfxTimeout() {
  tone('triangle', 330, 330, 0, 0.14, 0.2);
  tone('triangle', 247, 196, 0.15, 0.3, 0.2);
}

/** Eight-note wave-clear fanfare. */
export function sfxWaveClear() {
  [392, 523, 659, 784, 659, 784, 988, 1047].forEach((f, i) => tone('square', f, f, i * 0.085, i === 7 ? 0.4 : 0.08, 0.09));
}

/** Cannon lost / UFO down. */
export function sfxExplosion() { noiseSweep(900, 60, 0.7, 0.7); }

/** A ship lets a bomb go — a short falling whistle, kept quiet. */
export function sfxBombDrop() { tone('triangle', 740, 330, 0, 0.16, 0.05); }

/** A bomb chips the shields. */
export function sfxShieldHit() { noiseSweep(1800, 400, 0.12, 0.2); }

/** Power-up collected. */
export function sfxPowerUp() {
  [660, 880, 1320].forEach((f, i) => tone('triangle', f, f * 1.02, i * 0.05, 0.08, 0.14));
}

/** One step of the formation's four-note march bass. */
export function sfxMarch(step: number) {
  const f = [98, 87, 78, 73][step % 4];
  tone('square', f, f * 0.9, 0, 0.07, 0.05);
}

/** UFO warble; returns a stop function. */
export function sfxUfo(): () => void {
  const o = out(0.035);
  if (!o) return () => {};
  const osc = o.ctx.createOscillator();
  const lfo = o.ctx.createOscillator();
  const depth = o.ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 520;
  lfo.frequency.value = 7;
  depth.gain.value = 90;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  osc.connect(o.node);
  osc.start();
  lfo.start();
  return () => {
    try {
      osc.stop();
      lfo.stop();
      o.node.disconnect();
    } catch {
      /* already stopped */
    }
  };
}
