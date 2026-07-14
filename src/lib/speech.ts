import type { LanguageCode } from '../types';
import { ttsUrl } from './appApi';

// BCP-47 lang tags for known ISO 639-1 codes. Browsers will fall back if the
// exact region isn't installed; passing the bare code also works (the speech
// engine picks the best match) but tagging a region helps.
const BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ru: 'ru-RU',
  nl: 'nl-NL',
  pl: 'pl-PL',
  sv: 'sv-SE',
  tr: 'tr-TR',
  ar: 'ar-SA',
  hi: 'hi-IN',
  tl: 'fil-PH',
  ro: 'ro-RO',
  id: 'id-ID',
  th: 'th-TH',
  vi: 'vi-VN',
  ur: 'ur-PK',
};

function tagFor(lang: LanguageCode | 'en'): string {
  return BCP47[lang] ?? lang;
}

const VOLUME_KEY = 'peakvocabSpaceVolume';
export const DEFAULT_VOLUME = 0.36;

let volume: number = (() => {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    }
  } catch {
    /* ignore storage errors */
  }
  return DEFAULT_VOLUME;
})();

export function getVolume(): number {
  return volume;
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* ignore */
  }
}

export function speak(text: string, lang: LanguageCode | 'en', rate = 0.9, onEnd?: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  // A single uppercase letter alone gets read as "Capital X" by some voices;
  // lowercase it so the engine speaks it as a word.
  const safe = /^[A-Z]$/.test(text) ? text.toLowerCase() : text;
  const u = new SpeechSynthesisUtterance(safe);
  u.lang = tagFor(lang);
  u.rate = rate;
  u.volume = volume;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  window.speechSynthesis.speak(u);
}

// Speak a word/sentence in the user's avatar voice (ElevenLabs, proxied by the
// API). The proxy model is multilingual, so `opts.lang` lets the same voice
// pronounce native-language sentences (e.g. 'es'); omit for English. `opts.rate`
// slows playback for the listening-practice ▶ button (1.0 = normal, <1 slower)
// via playbackRate — no re-fetch, so the cached clip is reused at any speed.
// Falls back to the browser Web Speech voice (in `lang`, at `rate`) on any
// failure. `avatar` is the capitalized id (Ivy|Jade|Reed|Clay).
let currentAudio: HTMLAudioElement | null = null;
export function speakAvatar(
  text: string,
  avatar: string,
  opts: { lang?: LanguageCode | 'en'; rate?: number; onEnd?: () => void } = {},
) {
  if (typeof window === 'undefined') {
    opts.onEnd?.();
    return;
  }
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const lang = opts.lang ?? 'en';
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    // The fallback Web Speech utterance carries onEnd so callers waiting on
    // playback (e.g. before advancing a lesson step) still fire.
    speak(text, lang, opts.rate ?? 0.9, opts.onEnd);
  };
  // ALWAYS send lang (including 'en'): the API pre-generates clips keyed by
  // (voice, lang, text), so omitting it misses the cache and triggers a fresh,
  // billable, slower generation.
  const audio = new Audio(ttsUrl(text, avatar.toLowerCase(), lang));
  audio.volume = volume;
  if (opts.rate != null) {
    audio.playbackRate = opts.rate;
    // Keep pitch natural when slowed (otherwise the voice drops in pitch).
    (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  }
  if (opts.onEnd) audio.onended = opts.onEnd;
  audio.onerror = fallback;
  audio.play().catch(fallback);
  currentAudio = audio;
}

// First press = 0.7 (single-utterance sentences need a much lower rate
// than the old word-by-word path, which got perceived slowdown from
// inter-word gaps). Each additional press subtracts 0.1, floor at 0.45.
export function slowedRate(pressCount: number) {
  const presses = Math.max(0, pressCount - 1);
  return Math.max(0.45, 0.7 - 0.1 * presses);
}

// Inter-word gap. Base is large enough (200ms) that 10% growth per press is
// audibly different. Cap at +50% (300ms).
export function gapMsFor(pressCount: number) {
  const presses = Math.max(0, pressCount - 1);
  const base = 200;
  return Math.min(base * 1.5, base + base * 0.1 * presses);
}

export function speakWordByWord(text: string, lang: LanguageCode | 'en', pressCount: number) {
  // Speaks the full sentence as a single utterance at the press-count-derived
  // rate. Earlier word-by-word implementation clipped both ends of each word
  // on Spanish voices (and tail-clipped on Chrome English) because of
  // Web Speech API scheduling quirks; one utterance avoids that entirely.
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tagFor(lang);
  u.rate = slowedRate(pressCount);
  u.volume = volume;
  window.speechSynthesis.speak(u);
}
