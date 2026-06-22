import type { ApiWord, Profile, Sentence } from '../types';
import type { PickMode } from '../components/PickOne';
import { enrollUser, fetchPicturedWords, setAreas, setLevel } from '../lib/appApi';
import { shuffle } from '../lib/shuffle';
import { PICS_ONLY_ENABLED } from '../lib/env';

export const LESSON_LENGTH = 15;

// Climb round: the prompt shown above the cliff is either the word's native
// translation ('word') or its picture ('image'); the handholds always carry
// English words, one of which matches the prompt.
export type ClimbPromptKind = 'word' | 'image';
export interface ClimbRound {
  target: ApiWord;
  promptKind: ClimbPromptKind;
}

// A concrete renderable step. The lesson is now a single Climb to Safety step
// that plays LESSON_LENGTH rounds back-to-back; the other kinds are retained for
// the stage-only PICS ONLY review path and any future challenges.
export type LessonStep =
  | { kind: 'climb'; rounds: ClimbRound[] }
  | { kind: 'match'; targets: ApiWord[] }
  | { kind: 'pick'; pickMode: PickMode; target: ApiWord }
  | { kind: 'hearchoose'; sentence: Sentence }
  | { kind: 'translate'; version: 'A' | 'B'; sentence: Sentence };

export interface Lesson {
  number: number;
  steps: LessonStep[];
  bin: ApiWord[];
  debug: { lang: string; binCount: number; translatedCount: number; imageCount: number };
}

/** A refilling bag: returns distinct items until the pool is exhausted, then reshuffles. */
function makeBag<T>(pool: T[]): () => T {
  let bag: T[] = [];
  return () => {
    if (bag.length === 0) bag = shuffle(pool);
    return bag.pop()!;
  };
}

const hasNative = (w: ApiWord, language: string) => !!w.translations?.[language]?.[0]?.word;
const hasImage = (w: ApiWord) => !!w.pictureUrl;

/** Build the LESSON_LENGTH climb rounds from a pool of playable words. Each
 *  round's prompt is the word's native translation, its picture, or — when both
 *  exist — a coin flip between them. */
function buildRounds(pool: ApiWord[], language: string): ClimbRound[] {
  const nextTarget = makeBag(pool);
  return Array.from({ length: LESSON_LENGTH }, (): ClimbRound => {
    const target = nextTarget();
    const canWord = hasNative(target, language);
    const canImage = hasImage(target);
    const promptKind: ClimbPromptKind =
      canWord && canImage ? (Math.random() < 0.5 ? 'word' : 'image') : canWord ? 'word' : 'image';
    return { target, promptKind };
  });
}

export async function buildLesson(profile: Profile, lessonsCompleted: number): Promise<Lesson> {
  const { userId, language, avatarId, difficulty, areas } = profile;

  // Stage-only "PICS ONLY" review mode: image-prompt climb rounds drawn from
  // EVERY pictured word in the corpus — across all areas and difficulty levels,
  // independent of the user's level/area-scoped bin. Gated twice (the flag is
  // stage/dev-only and the category is only offered there) so it can never run
  // in production. Skips enroll/setLevel/setAreas — no mutation of user data.
  if (PICS_ONLY_ENABLED && profile.picsOnly) {
    const pics = await fetchPicturedWords();
    if (pics.length === 0) {
      throw new Error('PICS ONLY: no pictured words are available yet.');
    }
    const nextImage = makeBag(pics);
    const rounds: ClimbRound[] = Array.from({ length: LESSON_LENGTH }, () => ({
      target: nextImage(),
      promptKind: 'image',
    }));
    return {
      number: lessonsCompleted + 1,
      steps: [{ kind: 'climb', rounds }],
      bin: pics,
      debug: { lang: language, binCount: pics.length, translatedCount: 0, imageCount: pics.length },
    };
  }

  // Ensure the user exists, then apply the current level + area selections.
  // setLevel then setAreas each bench+refill the bin (progress preserved); the
  // setAreas response carries the resulting bin we build the lesson from.
  await enrollUser({ userId, nativeLanguage: language, avatar: avatarId, level: difficulty, areas });
  await setLevel(userId, difficulty);
  const binResp = await setAreas(userId, areas);
  const bin = binResp.words ?? [];

  if (bin.length === 0) {
    throw new Error(`No words available for ${difficulty} / areas [${areas.join(', ') || 'all'}].`);
  }

  // A word is playable as a climb round when we can show a prompt for it: its
  // native translation (word prompt) or its picture (image prompt). The handholds
  // themselves are English words drawn from the whole bin.
  const translated = bin.filter((w) => hasNative(w, language));
  const imageWords = bin.filter(hasImage);
  const playable = bin.filter((w) => hasNative(w, language) || hasImage(w));

  if (playable.length === 0) {
    throw new Error(
      'No challenges available yet — this native language has no translations loaded and no pictures are available.',
    );
  }

  return {
    number: lessonsCompleted + 1,
    steps: [{ kind: 'climb', rounds: buildRounds(playable, language) }],
    bin,
    debug: {
      lang: language,
      binCount: bin.length,
      translatedCount: translated.length,
      imageCount: imageWords.length,
    },
  };
}
