import type { AreaCode, Profile, ProgressResponse } from '../types';

const KEY = 'peakvocabSurvivalSave';
// Last fetched /progress, cached so the bar seeds from the real % after a reload
// (animating to the new value) instead of starting at 0. Kept separate from the
// profile save so the frequent profile writes never clobber it.
const KEY_PROGRESS = 'peakvocabSurvivalProgress';

export interface SaveState extends Profile {
  /** How many lessons this shopper has finished (gates the progress %). */
  lessonsCompleted: number;
  lastUpdated: number;
}

interface LegacySave {
  difficulty?: SaveState['difficulty'];
  areaCode?: AreaCode;            // old single-area schema
  areas?: AreaCode[];
  nativeLanguage?: SaveState['nativeLanguage'];
  language?: SaveState['language'];
  avatarId?: SaveState['avatarId'];
  audio?: boolean;
  userId?: number;
  lessonCount?: number;          // old field name
  lessonsCompleted?: number;
  lastUpdated?: number;
}

export function loadSave(): SaveState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LegacySave;
    if (!p.difficulty || !p.language) return null; // too stale to use
    return {
      userId: p.userId ?? 0,
      difficulty: p.difficulty,
      // Migrate the old single areaCode → multi-area; default [] = all areas.
      areas: p.areas ?? [],
      nativeLanguage: p.nativeLanguage ?? p.language!,
      language: p.language!,
      avatarId: p.avatarId ?? 'Ivy',
      audio: p.audio ?? true,
      lessonsCompleted: p.lessonsCompleted ?? p.lessonCount ?? 0,
      lastUpdated: p.lastUpdated ?? 0,
    };
  } catch {
    return null;
  }
}

export function writeSave(state: SaveState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore storage errors */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_PROGRESS);
  } catch {
    /* ignore */
  }
}

export function loadProgress(): ProgressResponse | null {
  try {
    const raw = localStorage.getItem(KEY_PROGRESS);
    return raw ? (JSON.parse(raw) as ProgressResponse) : null;
  } catch {
    return null;
  }
}

export function writeProgress(p: ProgressResponse) {
  try {
    localStorage.setItem(KEY_PROGRESS, JSON.stringify(p));
  } catch {
    /* ignore storage errors */
  }
}
