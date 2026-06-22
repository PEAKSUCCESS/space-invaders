import type {
  ApiWord,
  AreaCode,
  AreaInfo,
  AnswerMode,
  AvatarId,
  Difficulty,
  LanguageCode,
  ProgressResponse,
  Sentence,
} from '../types';

const BASE =
  (import.meta.env.VITE_VOCAB_API_URL as string | undefined) ??
  'https://peakvocab-api-stage-vkkf2.ondigitalocean.app';

// Shared app token for authenticated writes (enroll/answers/level/areas).
// NOTE: this ships in the frontend bundle and is therefore public — it's a
// low-sensitivity, rotatable app token by design (see .env.example).
const TOKEN = import.meta.env.VITE_APP_TOKEN as string | undefined;

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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(new URL(path, BASE).toString(), {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify(body),
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

// ── Endpoints ───────────────────────────────────────────────────────────────

export interface EnrollOpts {
  userId: number;
  nativeLanguage: LanguageCode;
  avatar?: AvatarId;            // capitalized internal id; lowercased on the wire
  level?: Difficulty;
  areas?: AreaCode[];           // [] = all areas
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

export function getBin(userId: number): Promise<BinResponse> {
  return getJson<BinResponse>(`/api/app/users/${userId}/bin`);
}

export function getNext(userId: number): Promise<NextResponse> {
  return getJson<NextResponse>(`/api/app/users/${userId}/next`);
}

/** Every word this user has ever been assigned, WITH its current streak/status —
 *  including `completed` words that have left the 20-word bin. Powers the
 *  start-screen streak buckets (learning / mastering / mastered). Unlike
 *  `getBin`, this is the full history, not the active working set. */
export async function getUserWords(userId: number): Promise<ApiWord[]> {
  const body = await getJson<{ userId: string; count: number; words: ApiWord[] }>(
    `/api/app/users/${userId}/words`,
  );
  return body.words ?? [];
}

export function submitAnswer(
  userId: number,
  answer: { senseId: string; correct: boolean; mode: AnswerMode },
): Promise<AnswerResponse> {
  return postJson<AnswerResponse>(`/api/app/users/${userId}/answers`, answer);
}

export function completeWord(userId: number, senseId: string): Promise<AnswerResponse> {
  return postJson<AnswerResponse>(`/api/app/users/${userId}/words/${senseId}/complete`, {});
}

/** Benches the current bin (keeps progress) and refills from the new level. */
export function setLevel(userId: number, level: Difficulty): Promise<BinResponse> {
  return postJson<BinResponse>(`/api/app/users/${userId}/level`, { level });
}

/** Benches the bin (keeps progress) and refills from the new areas. [] = all. */
export function setAreas(userId: number, areas: AreaCode[]): Promise<BinResponse> {
  return postJson<BinResponse>(`/api/app/users/${userId}/areas`, { areas });
}

export function getProgress(userId: number, areas?: AreaCode[]): Promise<ProgressResponse> {
  const q = areas && areas.length ? `?areas=${areas.join(',')}` : '';
  return getJson<ProgressResponse>(`/api/app/users/${userId}/progress${q}`);
}

// ── Feedback ─────────────────────────────────────────────────────────────────
// User-submitted feedback on a specific challenge. Recorded server-side in a
// `feedback` table; picture/word/sentence are filled in where applicable so the
// review tool can show what the feedback is about.
export interface FeedbackInput {
  userId: number;          // required — the API 400s without it
  userName?: string;       // PLP shopper identity, to attribute the report
  userEmail?: string;
  challengeType: string;   // human label, e.g. "Pick the Word (image)"
  challengeKind: string;   // step kind: pick | match | hearchoose | translate
  pickMode?: string;       // PickOne sub-mode when challengeKind is 'pick'
  senseId?: string;        // the word's stable id, when a single word is involved
  word?: string;           // the English word(s) shown
  pictureUrl?: string;     // absolute image URL, for image challenges
  sentence?: string;       // the sentence, for sentence challenges
  language: string;        // native language
  level: string;           // difficulty
  message: string;         // the user's typed feedback
}

/** Record challenge feedback (auth). */
export function submitFeedback(input: FeedbackInput): Promise<{ ok: boolean; id?: string | number }> {
  return postJson('/api/app/feedback', input);
}

// ── Leaderboard times ────────────────────────────────────────────────────────
// A completed game's total time, recorded server-side in a `lesson_times` table.
// Only flawless runs (wrongCount === 0) are ranked; the response carries this
// run's rank among all flawless runs for the same `app`.
export interface SubmitTimeInput {
  userId: number;       // required — attributes the run
  app: string;          // which game: 'balloons' | 'survival' | …
  durationMs: number;   // total time to finish the game
  wrongCount: number;   // wrong/missed answers this run (0 = flawless)
  rounds: number;       // how many rounds the game had (e.g. 15)
  level: string;        // difficulty, for context / future filtering
}

export interface TimeResult {
  durationMs: number;
  flawless: boolean;      // wrongCount === 0
  rank: number | null;    // 1-based rank among flawless runs (null when not flawless)
  totalFlawless: number;  // how many flawless runs exist for this app (incl. this one)
}

/** Record a completed game's time and get its rank among flawless runs (auth). */
export function submitTime(input: SubmitTimeInput): Promise<TimeResult> {
  return postJson<TimeResult>('/api/app/times', input);
}

export interface BestTime {
  bestMs: number | null;  // fastest flawless time for the app (null if none yet)
  count: number;          // how many flawless runs exist
}

/** Current best flawless time for an app — feeds the in-game countdown dial (no auth). */
export function fetchBestTime(app: string): Promise<BestTime> {
  return getJson<BestTime>(`/api/app/times/best?app=${encodeURIComponent(app)}`);
}

// This app's name, sent to scope UI strings to the Challenges app (the API's
// ui_strings table is shared across apps).
const APP_NAME = 'Challenges';

/** Native-language UI chrome strings for this app (no auth). Keyed by the same
 *  keys as src/i18n/strings.ts; any key the API omits falls back to the English
 *  default baked into the bundle. Returns {} for an unknown language. */
export async function fetchUiStrings(lang: string): Promise<Record<string, string>> {
  const body = await getJson<{ lang: string; strings: Record<string, string> }>(
    `/api/app/ui-strings?appName=${APP_NAME}&lang=${encodeURIComponent(lang)}`,
  );
  return body.strings ?? {};
}

/** Area picker source (no auth). Pass the learner's native language to get
 *  translated topic names in `area.translations[lang]` (English fallback per
 *  area). Use nativeLanguage= (not lang=) so an unsupported language returns
 *  200 with English rather than 400. */
export async function fetchAreas(nativeLanguage?: string): Promise<AreaInfo[]> {
  const q = nativeLanguage ? `?nativeLanguage=${encodeURIComponent(nativeLanguage)}` : '';
  const body = await getJson<{ count: number; areas: AreaInfo[] }>(`/api/vocab/areas${q}`);
  return body.areas;
}

/** Every corpus word that has a picture, across ALL areas + difficulty levels
 *  (no auth). Powers the stage-only PICS ONLY review mode — independent of any
 *  user's level/area-scoped bin. */
export async function fetchPicturedWords(): Promise<ApiWord[]> {
  const body = await getJson<{ count: number; words: ApiWord[] }>('/api/vocab/pictures');
  return body.words ?? [];
}

/** Absolute URL of a word's image, or null if it has none (abstract word or
 *  not-yet-generated). `pictureUrl` is a relative path; immutable/cacheable. */
export function imageUrl(word: { pictureUrl: string | null }): string | null {
  return word.pictureUrl ? new URL(word.pictureUrl, BASE).toString() : null;
}

/** URL of the avatar-voice TTS clip for `text` (no auth; immutable/cacheable).
 *  Returns audio/mpeg. `avatar` is the lowercase id (ivy|jade|reed|clay).
 *  `lang` is an optional ISO 639-1 hint (e.g. 'es') so the multilingual voice
 *  pronounces native-language sentences correctly; omit for English. */
export function ttsUrl(text: string, avatar: string, lang?: string): string {
  const u = new URL('/api/vocab/tts', BASE);
  u.searchParams.set('avatar', avatar);
  u.searchParams.set('text', text);
  if (lang) u.searchParams.set('lang', lang);
  return u.toString();
}

// ── Example sentences (no auth) ──────────────────────────────────────────────
// Standalone example sentences for an area + difficulty, pitched to that CEFR
// level, with an optional native translation when `lang` is passed (es only today).
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
