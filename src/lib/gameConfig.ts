// Runtime game tuning, fetched from a JSON config at startup so values can be
// changed WITHOUT rebuilding the app — edit the config and reload (no recompile,
// because the values are runtime data, not baked into the JS bundle).
//
// By default the config is the bundled `public/config.json` (served at /config.json).
// Set VITE_CONFIG_URL to fetch it from an external URL instead (e.g. the backend),
// which lets you change difficulty with no redeploy at all (that host must allow
// CORS). Missing/invalid fields fall back to the defaults below.

export interface GameConfig {
  waterRisePerSec: number; // % of the scene the water rises per second
  climbStep: number;       // % the climber rises per correct answer
  wrongSurge: number;      // % the water jumps on a wrong answer
  parTimeMs: number;       // countdown-dial target (ms) when there's no leaderboard best yet
}

export const DEFAULT_CONFIG: GameConfig = {
  waterRisePerSec: 0.9,
  climbStep: 4.3,
  wrongSurge: 3,
  parTimeMs: 75000,
};

const CONFIG_URL = (import.meta.env.VITE_CONFIG_URL as string | undefined) || '/config.json';

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Fetch the game config at runtime (cache-busted so edits are picked up). Returns
 *  the defaults on any failure, so the game always runs even if it's unreachable. */
export async function loadGameConfig(): Promise<GameConfig> {
  try {
    const sep = CONFIG_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${CONFIG_URL}${sep}t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_CONFIG;
    const j = (await res.json()) as Partial<GameConfig>;
    return {
      waterRisePerSec: num(j.waterRisePerSec, DEFAULT_CONFIG.waterRisePerSec),
      climbStep: num(j.climbStep, DEFAULT_CONFIG.climbStep),
      wrongSurge: num(j.wrongSurge, DEFAULT_CONFIG.wrongSurge),
      parTimeMs: num(j.parTimeMs, DEFAULT_CONFIG.parTimeMs),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
