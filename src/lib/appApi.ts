// ─────────────────────────────────────────────────────────────────────────────
// VENDORED — canonical peakvocab-api client. DO NOT EDIT IN A REPO.
// Source of truth: PeakVocab/shared/api-client/appApi.ts
// Synced into each activity's src/lib/appApi.ts by `node sync.mjs`.
// It's a SUPERSET: each activity imports the subset it needs (unused exports are
// tree-shaken out of the bundle — a shared client legitimately carries them).
// Per-app identity comes from VITE_APP_NAME so this file stays byte-identical.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ApiWord,
  AppConfig,
  AreaCode,
  AreaInfo,
  AreaTotals,
  AnswerMode,
  AvatarId,
  CorpusWord,
  Difficulty,
  LanguageCode,
  ProgressResponse,
  Sentence,
} from './apiTypes';

const BASE =
  (import.meta.env.VITE_VOCAB_API_URL as string | undefined) ??
  'https://peakvocab-api-stage-vkkf2.ondigitalocean.app';

// Shared app token for authenticated writes (enroll/answers/level/areas/times/feedback).
// NOTE: this ships in the frontend bundle and is therefore public — it's a
// low-sensitivity, rotatable app token by design (see .env.example).
const TOKEN = import.meta.env.VITE_APP_TOKEN as string | undefined;

// This activity's name, used to scope UI strings. Each repo sets VITE_APP_NAME
// (e.g. 'SpeedMatch'); the API merges the shared common set with any per-app
// overrides. Falls back to the shared 'Challenges' set when unset.
const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) || 'Challenges';

function writeHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(new URL(path, BASE).toString());
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown, keepalive = false): Promise<T> {
  const r = await fetch(new URL(path, BASE).toString(), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(body),
    // keepalive lets a teardown-time request (pagehide flush) outlive the page.
    ...(keepalive ? { keepalive: true } : {}),
  });
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

// ── Response shapes ─────────────────────────────────────────────────────────

/** Shared shape returned by enroll / bin / level / areas — all carry the bin. */
export interface BinResponse {
  userId: string;
  level: Difficulty;
  areas: AreaCode[];
  nativeLanguage: LanguageCode;
  avatar: string;
  count: number;
  words: ApiWord[];
  changed?: boolean; // only on POST /areas
  created?: boolean; // only on POST /users
}

export interface NextResponse {
  userId: string;
  avatar: string;
  word: ApiWord | null;
}

export interface AnswerResponse {
  userId: string;
  word: ApiWord;
  replacement: ApiWord | null;
  levelAdvancedTo: Difficulty | null;
}

// ── Bin engine (per-user) ────────────────────────────────────────────────────

export interface EnrollOpts {
  userId: string;
  nativeLanguage: LanguageCode;
  avatar?: AvatarId; // capitalized internal id; lowercased on the wire
  level?: Difficulty;
  areas?: AreaCode[]; // [] = all areas
}

/** Enroll a user (idempotent). First call auto-fills a 20-word bin. */
export function enrollUser(opts: EnrollOpts): Promise<BinResponse> {
  return postJson<BinResponse>('/api/app/users', {
    userId: opts.userId,
    nativeLanguage: opts.nativeLanguage,
    ...(opts.avatar ? { avatar: opts.avatar.toLowerCase() } : {}),
    ...(opts.level ? { level: opts.level } : {}),
    ...(opts.areas ? { areas: opts.areas } : {}),
  });
}

/** The user's active bin. Pass `size` to request a larger play-set (the real bin +
 *  transient, non-persisted overflow up to `size`) for games whose board churns faster
 *  than the 20-word bin (e.g. SpeedMatch). Returns fewer than `size` if the corpus is
 *  thin. Omit `size` for the plain bin. The size number itself is server-controlled —
 *  read it from getConfig().speedMatchPoolSize so it's changeable without a rebuild. */
export function getBin(userId: string, size?: number): Promise<BinResponse> {
  const q = size && size > 0 ? `?size=${Math.trunc(size)}` : '';
  return getJson<BinResponse>(`/api/app/users/${userId}/bin${q}`);
}

export function getNext(userId: string): Promise<NextResponse> {
  return getJson<NextResponse>(`/api/app/users/${userId}/next`);
}

/** Every word this user has ever been assigned, WITH its current streak/status —
 *  including `completed` words that have left the 20-word bin. Powers the
 *  start-screen streak buckets. Unlike `getBin`, this is the full history. */
export async function getUserWords(userId: string): Promise<ApiWord[]> {
  const body = await getJson<{ userId: string; count: number; words: ApiWord[] }>(
    `/api/app/users/${userId}/words`,
  );
  return body.words ?? [];
}

export function submitAnswer(
  userId: string,
  answer: { senseId: string; correct: boolean; mode: AnswerMode },
): Promise<AnswerResponse> {
  return postJson<AnswerResponse>(`/api/app/users/${userId}/answers`, answer);
}

export function completeWord(userId: string, senseId: string): Promise<AnswerResponse> {
  return postJson<AnswerResponse>(`/api/app/users/${userId}/words/${senseId}/complete`, {});
}

/** Benches the current bin (keeps progress) and refills from the new level. */
export function setLevel(userId: string, level: Difficulty): Promise<BinResponse> {
  return postJson<BinResponse>(`/api/app/users/${userId}/level`, { level });
}

/** Benches the bin (keeps progress) and refills from the new areas. [] = all. */
export function setAreas(userId: string, areas: AreaCode[]): Promise<BinResponse> {
  return postJson<BinResponse>(`/api/app/users/${userId}/areas`, { areas });
}

export function getProgress(userId: string, areas?: AreaCode[]): Promise<ProgressResponse> {
  const q = areas && areas.length ? `?areas=${areas.join(',')}` : '';
  return getJson<ProgressResponse>(`/api/app/users/${userId}/progress${q}`);
}

// ── Config (no auth) ──────────────────────────────────────────────────────────
/** The engine's tunable settings + CEFR↔difficulty maps. Read these instead of
 *  hardcoding COMPLETE_AT / the level mapping (they'd drift when app_setting changes). */
export function getConfig(): Promise<AppConfig> {
  return getJson<AppConfig>('/api/app/config');
}

// ── Feedback ─────────────────────────────────────────────────────────────────
export interface FeedbackInput {
  userId: string; // required — the API 400s without it
  userName?: string; // PLP shopper identity, to attribute the report
  userEmail?: string;
  challengeType: string; // human label, e.g. "Pick the Word (image)"
  challengeKind: string; // step kind: pick | match | hearchoose | translate | climb | cloze
  pickMode?: string; // PickOne sub-mode when challengeKind is 'pick'
  senseId?: string; // the word's stable id, when a single word is involved
  word?: string; // the English word(s) shown
  pictureUrl?: string; // absolute image URL, for image challenges
  sentence?: string; // the sentence, for sentence challenges
  language: string; // native language
  level: string; // difficulty
  message: string; // the user's typed feedback
}

/** Record challenge feedback (auth). */
export function submitFeedback(input: FeedbackInput): Promise<{ ok: boolean; id?: string | number }> {
  return postJson('/api/app/feedback', input);
}

// ── Active-usage time ─────────────────────────────────────────────────────────

export interface ActivityInput {
  userId: string; // the shopper's CUID
  app: string; // activity name, e.g. 'survival' | 'balloons' | 'speedmatch' | 'challenges' | 'hike'
  seconds: number; // idle-gated ACTIVE seconds (see lib/activityTime.ts), not wall-clock
  date: string; // the shopper's local calendar date, YYYY-MM-DD
}

/** Record a chunk of active usage (auth). Chunks for the same user/app/date sum
 *  server-side. `keepalive` lets the pagehide flush outlive the page. */
export function submitActivity(input: ActivityInput, keepalive = false): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>('/api/app/activity', input, keepalive);
}

export interface ActivityDay {
  date: string; // YYYY-MM-DD (as reported by the client at record time)
  app: string;
  seconds: number; // summed active seconds for that user/app/date
}

export interface ActivitySummary {
  userId: string;
  app: string | null; // the filter that was applied, if any
  days: number; // window size the server used
  totalSeconds: number; // sum over the whole window
  byDate: ActivityDay[]; // newest first
}

/** Per-date active-usage sums for a user (no auth), most recent `days` (server
 *  default 30). Pass `app` to scope to one activity — e.g. to drive the
 *  pineapple-spawn probability off recent active minutes. */
export function fetchActivity(
  userId: string,
  opts?: { app?: string; days?: number },
): Promise<ActivitySummary> {
  const u = new URL('/api/app/activity', BASE);
  u.searchParams.set('userId', userId);
  if (opts?.app) u.searchParams.set('app', opts.app);
  if (opts?.days) u.searchParams.set('days', String(Math.trunc(opts.days)));
  return getJson<ActivitySummary>(u.pathname + u.search);
}

// ── Pineapple token award ─────────────────────────────────────────────────────

/** Credit the found-the-pineapple token award (auth). Fire-and-forget from the
 *  game — call with `void`, never block or fail the YIPEE card on it. One fresh
 *  `findId` (UUID) is minted per find and reused across retries: the server
 *  builds its idempotency reference from it, so a retried request can never
 *  double-credit, while each new find pays again. Retries transient failures
 *  (network / 5xx) with the identical payload; a 4xx won't heal, so it gives up. */
export async function awardPineappleFind(userId: string, app: string): Promise<void> {
  const findId = crypto.randomUUID();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(new URL('/api/app/pineapple', BASE).toString(), {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ userId, app, findId }),
      });
      if (r.ok) return;
      if (r.status < 500) {
        console.error(`pineapple award rejected (${r.status}): ${await r.text()}`);
        return;
      }
    } catch {
      /* network error — retry */
    }
    await new Promise((res) => setTimeout(res, 1000 * attempt));
  }
  console.error('pineapple award failed after retries');
}

// ── Leaderboards (POST auth; GET none) ────────────────────────────────────────
// Two board types, chosen per board (each `app` string is one board):
//   • TIME  — fastest flawless run wins (Survival, Balloons). submitTime / fetchBestTime.
//   • SCORE — highest score wins (SpeedMatch: correct matches in 90s). submitScore / fetchBestScore.

export interface SubmitTimeInput {
  userId: string;
  app: string; // board name, e.g. 'survival' | 'balloons'
  durationMs: number; // total time to finish the game
  wrongCount: number; // wrong/missed answers this run (0 = flawless)
  rounds: number; // how many rounds the game had
  level: string; // difficulty, for context
}

export interface TimeResult {
  metric: 'time';
  durationMs: number;
  flawless: boolean; // wrongCount === 0
  rank: number | null; // 1-based rank among flawless runs (null when not flawless)
  totalFlawless: number; // flawless runs for this app (incl. this one)
}

/** Record a completed game's time and get its rank among flawless runs (auth). */
export function submitTime(input: SubmitTimeInput): Promise<TimeResult> {
  return postJson<TimeResult>('/api/app/times', { metric: 'time', ...input });
}

export interface BestTime {
  bestMs: number | null; // fastest flawless time for the app (null if none yet)
  count: number; // how many flawless runs exist
}

/** Current best flawless time for a time board (no auth). */
export function fetchBestTime(app: string): Promise<BestTime> {
  return getJson<BestTime>(`/api/app/times/best?app=${encodeURIComponent(app)}`);
}

export interface ScoreResult {
  metric: 'score';
  score: number;
  wrongCount: number;
  rank: number; // 1-based rank among all runs for this board (higher score = better)
  total: number; // total runs for this board (incl. this one)
}

/** Record a score-board run (e.g. SpeedMatch's correct-match count) and get its
 *  rank among all runs for the board (auth). The score is sent as `rounds`. */
export function submitScore(input: {
  userId: string;
  app: string; // board name, e.g. 'speedmatch'
  score: number; // the run's score (correct matches)
  wrongCount?: number;
  level?: string;
}): Promise<ScoreResult> {
  return postJson<ScoreResult>('/api/app/times', {
    userId: input.userId,
    app: input.app,
    metric: 'score',
    rounds: input.score,
    wrongCount: input.wrongCount ?? 0,
    ...(input.level ? { level: input.level } : {}),
  });
}

export interface BestScore {
  bestScore: number | null; // highest score for the board (null if none yet)
  count: number; // how many runs exist
}

/** Current high score for a score board (no auth). */
export function fetchBestScore(app: string): Promise<BestScore> {
  return getJson<BestScore>(`/api/app/times/best?app=${encodeURIComponent(app)}&by=score`);
}

// ── Corpus reads (no auth) ────────────────────────────────────────────────────

/** Native-language UI chrome strings for THIS activity (scoped by VITE_APP_NAME).
 *  Any key the API omits falls back to the English default baked into the bundle. */
export async function fetchUiStrings(lang: string): Promise<Record<string, string>> {
  const body = await getJson<{ lang: string; strings: Record<string, string> }>(
    `/api/app/ui-strings?appName=${encodeURIComponent(APP_NAME)}&lang=${encodeURIComponent(lang)}`,
  );
  return body.strings ?? {};
}

/** Area picker source (no auth). Pass the learner's native language to get
 *  translated topic names in `area.translations[lang]` (English fallback). Use
 *  nativeLanguage= so an unsupported language returns 200 (English) not 400. */
export async function fetchAreas(nativeLanguage?: string): Promise<AreaInfo[]> {
  const q = nativeLanguage ? `?nativeLanguage=${encodeURIComponent(nativeLanguage)}` : '';
  const body = await getJson<{ count: number; areas: AreaInfo[] }>(`/api/vocab/areas${q}`);
  return body.areas;
}

/** Per-area × per-difficulty corpus word counts (no auth, user-agnostic). The
 *  shared denominator for every activity's progress bars — no /progress needed. */
export async function fetchAreaTotals(): Promise<AreaTotals> {
  const body = await getJson<{ totals: AreaTotals }>('/api/vocab/area-totals');
  return body.totals ?? {};
}

/** Corpus words for an area+difficulty (no auth): every word at that level,
 *  WITHOUT per-user state (no status/streak) — carries `senseId`, same key as
 *  the bin endpoints. Used for the "all words" list + cloze validation. */
export async function fetchWords(
  area: AreaCode,
  difficulty: Difficulty,
  lang?: LanguageCode,
): Promise<CorpusWord[]> {
  const u = new URL('/api/vocab/words', BASE);
  u.searchParams.set('area', area);
  u.searchParams.set('difficulty', difficulty);
  if (lang) u.searchParams.set('lang', lang);
  const body = await getJson<{ words: CorpusWord[] }>(u.pathname + u.search);
  return body.words ?? [];
}

/** Every corpus word that has a picture, across ALL areas + levels (no auth).
 *  Powers the stage-only PICS ONLY review mode. */
export async function fetchPicturedWords(): Promise<ApiWord[]> {
  const body = await getJson<{ count: number; words: ApiWord[] }>('/api/vocab/pictures');
  return body.words ?? [];
}

/** Example sentences for an area + difficulty (no auth), pitched to that CEFR
 *  level, with an optional native translation when `lang` is passed (es only today). */
export async function fetchSentences(
  area: AreaCode,
  difficulty: Difficulty,
  lang?: LanguageCode,
): Promise<Sentence[]> {
  const u = new URL('/api/vocab/sentences', BASE);
  u.searchParams.set('area', area);
  u.searchParams.set('difficulty', difficulty);
  if (lang) u.searchParams.set('lang', lang);
  const body = await getJson<{ sentences: Sentence[] }>(u.pathname + u.search);
  return body.sentences ?? [];
}

// ── URL builders (no request) ────────────────────────────────────────────────

/** Absolute URL of a word's image, or null if it has none. `pictureUrl` is a
 *  relative path; immutable/cacheable (carries a ?v= cache-buster). */
export function imageUrl(word: { pictureUrl: string | null }): string | null {
  return word.pictureUrl ? new URL(word.pictureUrl, BASE).toString() : null;
}

/** URL of the avatar-voice TTS clip for `text` (no auth; immutable/cacheable).
 *  `avatar` is the lowercase id (ivy|jade|reed|clay); `lang` is an optional ISO
 *  639-1 hint so the multilingual voice pronounces native sentences correctly. */
export function ttsUrl(text: string, avatar: string, lang?: string): string {
  const u = new URL('/api/vocab/tts', BASE);
  u.searchParams.set('avatar', avatar);
  u.searchParams.set('text', text);
  if (lang) u.searchParams.set('lang', lang);
  return u.toString();
}
