// ─────────────────────────────────────────────────────────────────────────────
// VENDORED — canonical peakvocab-api types. DO NOT EDIT IN A REPO.
// Source of truth: PeakVocab/shared/api-client/apiTypes.ts
// Synced into each activity's src/lib/apiTypes.ts by `node sync.mjs`.
// Each repo's src/types.ts re-exports these + adds its own app-specific types.
// ─────────────────────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard';
export type AreaCode = string; // 3-letter master-topic code, e.g. 'DLF', 'FOD'
export type LanguageCode = string; // ISO 639-1, e.g. 'es', 'pt', 'fr'
export type AvatarId = 'Clay' | 'Ivy' | 'Jade' | 'Reed';

export type WordStatus = 'new' | 'proficient' | 'mastered' | 'completed';

/** Which challenge type an answer records (server just stores it). */
export type AnswerMode = 'definition' | 'identification' | 'translation';

/** One ranked native-language synonym for a word (index 0 is primary). */
export interface ApiTranslation {
  word: string; // the term in the user's native language
  definition: string; // the definition in the user's native language
}

/** A word/sense as returned by every endpoint that surfaces words. The corpus
 *  endpoint /api/vocab/words returns everything here EXCEPT `status`/`streak`
 *  (those are per-user) — see the `CorpusWord` alias below. */
export interface ApiWord {
  senseId: string; // STABLE id — used to submit answers / complete (same key on every endpoint)
  english: string; // the English word (also the TTS text)
  partOfSpeech: string; // 'noun' | 'verb' | …
  status: WordStatus;
  streak: number;
  difficulty: Difficulty;
  cefr: string; // 'A1'–'C1'
  definition: string; // ENGLISH definition
  ipa: string | null;
  pictureUrl: string | null; // relative image path (resolve via imageUrl()); null if none
  areas: AreaCode[];
  forms?: Record<string, string>; // inflections, only when present
  translations?: Record<string, ApiTranslation[]>; // native content, only when available
}

/** The shape of a /api/vocab/words row: a word WITHOUT per-user state. */
export type CorpusWord = Omit<ApiWord, 'status' | 'streak'>;

export interface ProgressLevel {
  level: Difficulty;
  total: number;
  completed: number;
  percent: number;
}

export interface ProgressResponse {
  userId: string;
  areas: AreaCode[];
  levels: ProgressLevel[];
}

export interface AreaInfo {
  code: AreaCode;
  english: string;
  // Native-language topic name per language, present only when GET /api/vocab/areas
  // is called with nativeLanguage= and a translation exists. Render translations[lang]
  // when present, else fall back to english.
  translations?: Record<string, string>;
}

/** Example sentence from GET /api/vocab/sentences. `translation` is the native
 *  rendering for the requested lang — present only when lang is passed and a
 *  translation exists (always null-check). */
export interface Sentence {
  id?: string;
  english: string;
  translation?: string;
  // The cloze / fill-in-the-blank target — present only for annotated sentences.
  // The sentence teaches this NOUN sense; blank exactly `blankWord` and show the
  // sense's own clue (nativeDefinition ?? definition, or pictureUrl).
  senseId?: string;
  blankWord?: string; // exact surface token to blank (e.g. "water")
  definition?: string; // the target sense's English definition
  nativeDefinition?: string; // its native-language definition (when ?lang= is passed)
  pictureUrl?: string; // the target sense's picture (relative; resolve with imageUrl)
}

/** GET /api/app/config — the tunable engine settings + CEFR↔difficulty maps, so
 *  clients don't hardcode thresholds / bin depth / the level mapping. */
export interface AppConfig {
  binDepth: number;
  pos: string[];
  thresholds: { proficient: number; mastered: number; completed: number };
  freqs: { new: number; proficient: number; mastered: number };
  cefrToDifficulty: Record<string, Difficulty>;
  difficultyToCefr: Record<Difficulty, string[]>;
}

/** GET /api/vocab/area-totals — corpus (user-agnostic) word counts per area × level. */
export type AreaTotals = Record<string, { easy: number; medium: number; hard: number }>;
