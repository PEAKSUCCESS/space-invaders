import type { ApiWord, Profile, Sentence } from '../types';
import type { PickMode } from '../components/PickOne';
import { enrollUser, fetchPicturedWords, getUserWords, setAreas, setLevel } from '../lib/appApi';
import { shuffle } from '../lib/shuffle';
import { PICS_ONLY_ENABLED } from '../lib/env';

export const LESSON_LENGTH = 15;
const PICS_ONLY_SAMPLE = 48;

// One climb round pairs a clue with the kind of choices shown. English is always
// on one side, giving four modes the lesson randomly switches between:
//   image  clue → English choices  |  English clue → image  choices
//   native clue → English choices  |  English clue → native choices
export type ClueKind = 'image' | 'englishWord' | 'nativeWord';
export type ChoiceKind = 'image' | 'englishWord' | 'nativeWord';
export interface ClimbRound {
  target: ApiWord;
  clueKind: ClueKind;
  choiceKind: ChoiceKind;
}

// The four (clue, choices) modes; each round is assigned one the data supports.
const CLIMB_MODES: Array<{ clueKind: ClueKind; choiceKind: ChoiceKind }> = [
  { clueKind: 'image', choiceKind: 'englishWord' },
  { clueKind: 'englishWord', choiceKind: 'image' },
  { clueKind: 'nativeWord', choiceKind: 'englishWord' },
  { clueKind: 'englishWord', choiceKind: 'nativeWord' },
];
const CLIMB_CHOICE_COUNT = 4; // tiles per round (1 correct + distractors)

// A concrete renderable step. The lesson is now a single Space Invaders step —
// the game plans its own waves from `targets` (the bin: what gets asked) and
// `pool` (every word the learner has met: where distractors come from). The
// other kinds are retained components (climb = Asteroids / Climb to Safety).
export type LessonStep =
  | { kind: 'invaders'; targets: ApiWord[]; pool: ApiWord[]; picsOnly?: boolean }
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

/** Which of the four modes a target supports, given how many words in the pool
 *  carry a picture / a native translation (image & native CHOICES need a poolful). */
function availableModes(
  target: ApiWord, language: string, picturedCount: number, nativeCount: number,
): Array<{ clueKind: ClueKind; choiceKind: ChoiceKind }> {
  const img = hasImage(target);
  const nat = hasNative(target, language);
  const modes: Array<{ clueKind: ClueKind; choiceKind: ChoiceKind }> = [];
  if (img) modes.push(CLIMB_MODES[0]);                                        // image clue → English choices
  if (img && picturedCount >= CLIMB_CHOICE_COUNT) modes.push(CLIMB_MODES[1]); // English clue → image choices
  if (nat) modes.push(CLIMB_MODES[2]);                                        // native clue → English choices
  if (nat && nativeCount >= CLIMB_CHOICE_COUNT) modes.push(CLIMB_MODES[3]);   // English clue → native choices
  return modes;
}

// The API removes a word from the bin (out of service) once its streak hits the
// completion threshold; until then we keep every bin word in rotation but show it
// LESS as its streak climbs. Weight is linear (streak 0 → COMPLETION_STREAK, near
// mastery → 1), clamped to ≥1 so no in-service word is ever fully dropped.
const COMPLETION_STREAK = 20;
const streakWeight = (w: ApiWord) => Math.max(1, COMPLETION_STREAK - (w.streak ?? 0));

/** Pick a word weighted by streak (lower streak → more frequent), excluding the
 *  previous round's word so the same word never appears twice in a row. */
export function weightedPick(pool: ApiWord[], excludeSenseId: string | null): ApiWord {
  const list = pool.filter((w) => w.senseId !== excludeSenseId);
  const choices = list.length > 0 ? list : pool; // degenerate: a pool of one
  const total = choices.reduce((sum, w) => sum + streakWeight(w), 0);
  let r = Math.random() * total;
  for (const w of choices) {
    r -= streakWeight(w);
    if (r <= 0) return w;
  }
  return choices[choices.length - 1];
}

/** Build the LESSON_LENGTH climb rounds (retained: Asteroids / Climb to Safety). Targets are drawn **streak-weighted** —
 *  lower-streak (less-known) words come up more often, mastered ones less, until
 *  their streak takes them out of service — and never the same word twice in a row;
 *  each gets a random clue/choice mode the data supports. */
export function buildRounds(pool: ApiWord[], language: string): ClimbRound[] {
  const picturedCount = pool.filter(hasImage).length;
  const nativeCount = pool.filter((w) => hasNative(w, language)).length;
  let prevSenseId: string | null = null;
  return Array.from({ length: LESSON_LENGTH }, (): ClimbRound => {
    // pool is pre-filtered to playable words, so a mode always exists.
    const target = weightedPick(pool, prevSenseId);
    prevSenseId = target.senseId;
    const modes = availableModes(target, language, picturedCount, nativeCount);
    const m = modes[Math.floor(Math.random() * modes.length)] ?? CLIMB_MODES[2];
    return { target, clueKind: m.clueKind, choiceKind: m.choiceKind };
  });
}

export async function buildLesson(profile: Profile, lessonsCompleted: number): Promise<Lesson> {
  const { userId, nativeLanguage, avatarId, difficulty, areas } = profile;

  // Stage-only "PICS ONLY" review mode: picture waves drawn from EVERY pictured
  // word in the corpus — across all areas and difficulty levels, independent of
  // the user's level/area-scoped bin. Gated twice (the flag is stage/dev-only
  // and the category is only offered there) so it can never run in production.
  // Skips enroll/setLevel/setAreas — no mutation of user data.
  if (PICS_ONLY_ENABLED && profile.picsOnly) {
    const pics = await fetchPicturedWords();
    if (pics.length === 0) {
      throw new Error('PICS ONLY: no pictured words are available yet.');
    }
    // A sample to ask about (each picture is preloaded); the whole set supplies distractors.
    const nextImage = makeBag(pics);
    const sample = [...new Map(Array.from({ length: Math.min(PICS_ONLY_SAMPLE, pics.length) }, () => {
      const w = nextImage();
      return [w.senseId, w] as const;
    })).values()];
    return {
      number: lessonsCompleted + 1,
      steps: [{ kind: 'invaders', targets: sample, pool: pics, picsOnly: true }],
      bin: pics,
      debug: { lang: nativeLanguage, binCount: pics.length, translatedCount: 0, imageCount: pics.length },
    };
  }

  // Ensure the user exists, then apply the current level + area selections.
  // setLevel then setAreas each bench+refill the bin (progress preserved); the
  // setAreas response carries the resulting bin we build the lesson from.
  await enrollUser({ userId, nativeLanguage, avatar: avatarId, level: difficulty, areas });
  await setLevel(userId, difficulty);
  const binResp = await setAreas(userId, areas);
  const bin = binResp.words ?? [];

  if (bin.length === 0) {
    throw new Error(`No words available for ${difficulty} / areas [${areas.join(', ') || 'all'}].`);
  }

  // A word is playable as a climb round when we can show a prompt for it: its
  // native translation (word prompt) or its picture (image prompt). The handholds
  // themselves are English words drawn from the whole bin.
  const translated = bin.filter((w) => hasNative(w, nativeLanguage));
  const imageWords = bin.filter(hasImage);
  const playable = bin.filter((w) => hasNative(w, nativeLanguage) || hasImage(w));

  if (playable.length === 0) {
    throw new Error(
      'No challenges available yet — this native language has no translations loaded and no pictures are available.',
    );
  }

  // Distractors come from every word the learner has met, so a wrong answer is a
  // real discrimination failure rather than an unknown word. Non-fatal: the bin
  // alone still makes a game.
  const history = await getUserWords(userId).catch(() => [] as ApiWord[]);
  const pool = [...new Map([...bin, ...history].map((w) => [w.senseId, w])).values()];

  return {
    number: lessonsCompleted + 1,
    steps: [{ kind: 'invaders', targets: playable, pool }],
    bin,
    debug: {
      lang: nativeLanguage,
      binCount: bin.length,
      translatedCount: translated.length,
      imageCount: imageWords.length,
    },
  };
}
