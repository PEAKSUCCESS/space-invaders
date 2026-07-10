// ─────────────────────────────────────────────────────────────────────────────
// VENDORED — canonical active-usage tracker. DO NOT EDIT IN A REPO.
// Source of truth: PeakVocab/shared/api-client/activityTime.ts
// Synced into each activity's src/lib/activityTime.ts by `node sync.mjs`.
// ─────────────────────────────────────────────────────────────────────────────
// Tallies the seconds a shopper ACTIVELY uses an activity — not how long the
// tab sits open. The counter runs only while the page is visible and there has
// been mouse/keyboard/touch interaction within the last IDLE_CUTOFF_MS (10s):
// a 10-second interaction gap stops the tally, and the next interaction
// resumes it (the trailing idle window itself counts — the shopper may be
// reading/listening between clicks).
//
// The tally is reported to POST /api/app/activity as (userId, app, seconds,
// local date) and reset:
//   • explicitly via flushActivity() — call where the game finishes or quits
//     (just before navigating back to the hub), and
//   • automatically on pagehide and on tab-hidden (keepalive fetch), so a
//     closed tab, the header's Home button, or backgrounded mobile Safari
//     never loses the tally.
// Flushing resets the counter and zero-second flushes are skipped, so the
// explicit + automatic hooks never double-report; multiple chunks for the same
// user/app/date simply sum server-side.

import { fetchActivity, submitActivity } from './appApi';

const IDLE_CUTOFF_MS = 10_000; // "X" — the interaction gap that stops the tally
const TICK_MS = 1_000;

const INTERACT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

let identity: { userId: string; app: string } | null = null;
let tallyMs = 0;
let lastEventTs = 0;
let lastTickTs = 0;
let timer: number | null = null;

function onInteract() {
  lastEventTs = Date.now();
}

function tick() {
  const now = Date.now();
  // Clamp dt so a timer-throttled background tab can't dump its whole gap into
  // the tally on the first tick after waking.
  const dt = Math.min(now - lastTickTs, TICK_MS * 2);
  lastTickTs = now;
  if (!document.hidden && now - lastEventTs <= IDLE_CUTOFF_MS) tallyMs += dt;
}

function localDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Report the active seconds tallied so far (if any) and reset the counter.
 *  Call where the game finishes or quits; the pagehide/tab-hidden listeners
 *  also call it. Fire-and-forget — usage stats are best-effort and must never
 *  surface an error to the shopper. */
export function flushActivity(keepalive = false): void {
  if (!identity) return;
  const seconds = Math.round(tallyMs / 1000);
  tallyMs = 0;
  if (seconds <= 0) return;
  submitActivity({ ...identity, seconds, date: localDate() }, keepalive).catch(() => {
    /* best-effort */
  });
}

// ── Pineapple odds ────────────────────────────────────────────────────────────
// The hidden-pineapple easter egg rewards recent engagement: the more active
// usage across ALL activities in the past 14 days, the likelier the spawn.

const PINEAPPLE_WINDOW_DAYS = 14;

/** Map 14-day active seconds → spawn probability (0–1). Bands per Brad. */
export function pineappleChance(totalSeconds: number): number {
  if (totalSeconds > 12000) return 1; // 12001+
  if (totalSeconds > 8000) return 0.8; // 8001–12000
  if (totalSeconds > 4000) return 0.5; // 4001–8000
  if (totalSeconds >= 2000) return 0.25; // 2000–4000
  return 0.1; // everyone else
}

/** The user's pineapple-spawn probability from their last-14-days active usage
 *  across all activities. Falls back to the 10% floor if the endpoint is
 *  missing/unreachable — the egg just stays rare, never an error. */
export async function fetchPineappleChance(userId: string): Promise<number> {
  try {
    const a = await fetchActivity(userId, { days: PINEAPPLE_WINDOW_DAYS });
    return pineappleChance(a.totalSeconds);
  } catch {
    return pineappleChance(0);
  }
}

/** Start tracking (idempotent — safe under React strict-mode double effects).
 *  Call once the launch userId is known; `app` is the lowercase activity name
 *  ('survival', 'balloons', 'speedmatch', 'challenges', 'hike'). */
export function initActivityTracking(userId: string, app: string): void {
  identity = { userId, app };
  if (timer != null) return; // listeners + timer already installed
  lastEventTs = Date.now(); // opening the app counts as the first interaction
  lastTickTs = lastEventTs;
  for (const ev of INTERACT_EVENTS) {
    window.addEventListener(ev, onInteract, { passive: true, capture: true });
  }
  timer = window.setInterval(tick, TICK_MS);
  // Teardown flushes: pagehide covers navigation/close on desktop;
  // visibilitychange→hidden is the only reliable last-chance hook on mobile.
  window.addEventListener('pagehide', () => flushActivity(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushActivity(true);
  });
}
