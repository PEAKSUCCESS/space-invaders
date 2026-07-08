// Build-time deploy environment, injected from Vercel's VERCEL_ENV by
// vite.config (see `define`). 'production' for main, 'preview' for stage,
// '' locally.
declare const __VERCEL_ENV__: string;

// "PICS ONLY" is a stage/dev-only review category — NEVER production. It shows
// in local dev, on Vercel preview deploys (the stage branch), or when an
// explicit VITE_PICS_ONLY=1 is set for an environment. This fails closed:
// production (main) matches none of these, so the category stays hidden.
export const PICS_ONLY_ENABLED: boolean =
  import.meta.env.DEV ||
  __VERCEL_ENV__ === 'preview' ||
  import.meta.env.VITE_PICS_ONLY === '1';

// The vocab hub (landing page) this game returns to when a session is
// completed or quit. We normally get back to it via history.back() (the hub
// launched us in this same tab), so this URL is the fallback when there's no
// history — tier-matched to this build (prod hub for main, stage branch-alias
// otherwise). Override with VITE_CHALLENGES_URL.
export const CHALLENGES_HUB_URL: string =
  import.meta.env.VITE_CHALLENGES_URL ||
  (__VERCEL_ENV__ === 'production'
    ? 'https://peakvocab-vocab-hub.vercel.app'
    : 'https://peakvocab-vocab-hub-git-stage-peak-esl1.vercel.app');
