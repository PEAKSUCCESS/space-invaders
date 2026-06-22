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
