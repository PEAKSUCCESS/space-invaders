import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { AnswerMode, ApiWord, AvatarId, LanguageCode } from '../types';
import type { GameConfig } from '../lib/gameConfig';
import { imageUrl } from '../lib/appApi';
import { speakAvatar } from '../lib/speech';
import { unlockArcadeAudio } from '../lib/sound';
import { H, InvadersEngine, W, type InvadersResult } from '../game/invadersEngine';
import { t } from '../i18n/i18n';

interface Props {
  targets: ApiWord[];              // the bin — what gets asked
  pool: ApiWord[];                 // every word the learner has met — distractors
  language: LanguageCode;
  avatarId: AvatarId;
  audio?: boolean;
  paused?: boolean;                // freeze the game (e.g. feedback modal open)
  config: GameConfig;
  picsOnly?: boolean;
  pineappleChance?: number;        // 0–1 odds the hidden pineapple saucer flies this game
  bestScore?: number;              // HI-SCORE on the attract screen
  onAnswer: (senseId: string, correct: boolean, mode: AnswerMode) => void;
  onLive?: (word: ApiWord | null) => void;   // the prompt now on the cannon (feedback context)
  onComplete: (result: InvadersResult) => void;
  onPineappleFound?: () => void;
}

const STEP = 1 / 60;

// Downscale a word picture once into a high-quality square copy — large enough
// for the biggest on-screen use (64 logical px) at up to 4 device px each.
const PICTURE_PX = 256;
function preparePicture(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const k = Math.min(1, size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

function rollPineapple(chance: number) {
  return Math.random() < chance;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const typingInto = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function SpaceInvaders(props: Props) {
  const { audio = true, paused = false, bestScore = 0 } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InvadersEngine | null>(null);
  const [yipeeOpen, setYipeeOpen] = useState(false);
  // Callbacks change identity every App render; the engine reads the latest via this ref.
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });

  // One engine per mount: the game loop, input, and picture preloading.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const p = propsRef.current;
    const engine = new InvadersEngine({
      targets: p.targets,
      pool: p.pool,
      language: p.language,
      picsOnly: !!p.picsOnly,
      waves: p.config.waves,
      promptsPerWave: p.config.promptsPerWave,
      descentScale: p.config.descentScale,
      approachScale: p.config.approachScale,
      pineapple: rollPineapple(p.pineappleChance ?? 0.1),
      reducedMotion: prefersReducedMotion(),
      onAnswer: (senseId, correct, mode) => propsRef.current.onAnswer(senseId, correct, mode),
      onLive: (word) => propsRef.current.onLive?.(word),
      onComplete: (result) => propsRef.current.onComplete(result),
      onPineapple: () => {
        setYipeeOpen(true);
        propsRef.current.onPineappleFound?.();
      },
      speak: (text, lang) => speakAvatar(text, propsRef.current.avatarId, { lang }),
    });
    engineRef.current = engine;

    // Only the bin's pictures are ever shown (prompts + the wave report).
    let alive = true;
    for (const w of p.targets) {
      const src = imageUrl(w);
      if (!src) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (alive && img.naturalWidth > 0) engine.setPicture(w.senseId, preparePicture(img, PICTURE_PX));
      };
      img.src = src;
    }

    // Fixed-step accumulator at 60 Hz; render once per animation frame.
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      const pad = navigator.getGamepads?.().find((g) => g && g.connected);
      if (pad) engine.gamepad(pad.axes[0] ?? 0, !!pad.buttons[0]?.pressed, !!pad.buttons[9]?.pressed);
      while (acc >= STEP) {
        engine.update(STEP);
        acc -= STEP;
      }
      // Everything is drawn in logical units onto a device-resolution backing store.
      const r = canvas.width / W;
      ctx.setTransform(r, 0, 0, r, 0, 0);
      engine.render(ctx);
    };
    raf = requestAnimationFrame(frame);

    const onKeyDown = (e: KeyboardEvent) => {
      if (typingInto(e.target)) return;
      unlockArcadeAudio();
      if (engine.keyDown(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => engine.keyUp(e.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.focus({ preventScroll: true });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => { engineRef.current?.setHold(paused || yipeeOpen); }, [paused, yipeeOpen]);
  useEffect(() => { engineRef.current?.setAudio(audio); }, [audio]);
  useEffect(() => { engineRef.current?.setBest(bestScore); }, [bestScore]);

  // Size the 320×256 screen to the panel. On 1× displays snap to whole pixels so
  // every pixel stays square; on high-DPI screens (phones) fill the space — the
  // uneven device pixels don't show there, and every extra CSS pixel of text counts.
  // The backing store matches the device pixels, so pictures render sharp while
  // the pixel art (drawn in whole logical pixels) stays blocky.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const k = Math.min(wrap.clientWidth / W, wrap.clientHeight / H);
      const scale = dpr >= 2 ? k : Math.max(1, Math.floor(k * dpr)) / dpr;
      canvas.style.width = `${W * scale}px`;
      canvas.style.height = `${H * scale}px`;
      const backing = Math.min(8, Math.max(1, Math.ceil(scale * dpr - 0.01)));
      if (canvas.width !== W * backing) {
        canvas.width = W * backing;
        canvas.height = H * backing;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  function toLogical(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  return (
    <div className="inv-game" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="inv-canvas"
        tabIndex={0}
        role="application"
        aria-label={t('inv.a11y')}
        onPointerDown={(e) => {
          unlockArcadeAudio();
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          const { x, y } = toLogical(e);
          engineRef.current?.pointerDown(x, y);
        }}
        onPointerMove={(e) => engineRef.current?.pointerMove(toLogical(e).x)}
        onPointerUp={() => engineRef.current?.pointerUp()}
        onPointerCancel={() => engineRef.current?.pointerUp()}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Found-the-pineapple celebration — holds the game until OK. */}
      {yipeeOpen && (
        <div className="yipee-overlay">
          <div className="yipee-card">
            <div className="yipee-title">YIPEE</div>
            <p className="yipee-msg">{t('pineapple.found')}</p>
            <button type="button" className="yipee-ok-btn" onClick={() => setYipeeOpen(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
