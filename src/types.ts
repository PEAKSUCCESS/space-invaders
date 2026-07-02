// API DTOs + shared enums live in the vendored client (src/lib/apiTypes.ts, synced
// from PeakVocab/shared/api-client). Re-export them so imports from '../types' keep working.
export * from './lib/apiTypes';
import type { AreaCode, AvatarId, Difficulty, LanguageCode } from './lib/apiTypes';

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
