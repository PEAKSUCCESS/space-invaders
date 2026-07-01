export type Difficulty = 'easy' | 'medium' | 'hard';
export type AreaCode = string;          // 3-letter master-topic code, e.g. 'DLF', 'FOD'
export type LanguageCode = string;       // ISO 639-1, e.g. 'es', 'pt', 'fr'
export type AvatarId = 'Clay' | 'Ivy' | 'Jade' | 'Reed';

// ── New user-centric API model ────────────────────────────────────────────

export type WordStatus = 'new' | 'proficient' | 'mastered' | 'completed';

/** One ranked native-language synonym for a word (index 0 is primary). */
export interface ApiTranslation {
  word: string;        // the term in the user's native language
  definition: string;  // the definition in the user's native language
}

/** A word/sense as returned by every endpoint that surfaces words. */
export interface ApiWord {
  senseId: string;                 // STABLE id — used to submit answers / complete
  english: string;                 // the English word (also the TTS text)
  partOfSpeech: string;            // 'noun' | 'verb' | …
  status: WordStatus;
  streak: number;
  difficulty: Difficulty;
  cefr: string;                    // 'A1'–'C1'
  definition: string;              // ENGLISH definition
  ipa: string | null;
  pictureUrl: string | null;       // image url (null across the corpus today)
  areas: AreaCode[];
  forms?: Record<string, string>;  // inflections, only when present
  translations?: Record<string, ApiTranslation[]>; // native content, only when available
}

/** Which challenge type an answer records (server just stores it). */
export type AnswerMode = 'definition' | 'identification' | 'translation';

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
 *  translation exists (always null-check). Feeds HearAndChoose / TranslateWhatYouHear. */
export interface Sentence {
  id?: string;
  english: string;
  translation?: string;
}

export interface Profile {
  userId: string;           // opaque CUID
  difficulty: Difficulty;   // maps to the API `level`
  areas: AreaCode[];        // [] = all areas
  nativeLanguage: LanguageCode; // vocab CONTENT (sent on enroll)
  language: LanguageCode;   // UI/DISPLAY (all t())
  avatarId: AvatarId;
  audio: boolean;
  picsOnly?: boolean;       // stage-only: build an image-only lesson for picture review
}

export type Phase =
  | { kind: 'start' }
  | { kind: 'challenge'; index: number }
  | { kind: 'celebrate' };
