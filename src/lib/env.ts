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
