// Space Invaders — the teaching rules, kept free of any drawing so the engine
// only has to play what this file plans: the difficulty ramp, round types,
// scoring, and which words become a wave's prompts and distractor tiles.
import type { AnswerMode, ApiWord, LanguageCode } from '../types';
import { fitLines } from './bitmapFont';
import { shuffle } from '../lib/shuffle';
import { weightedPick } from './lesson';

export const COLS = 5;
export const TILE_W = 58;
export const TILE_H = 24;
export const TILE_GAP = 4;
export const TILE_TEXT_W = TILE_W - 4;
export const ROW_PITCH = TILE_H + TILE_GAP;   // 28 — the pushback a correct answer buys
export const UFO_COLS = [0, 2, 4];            // a UFO round's three candidates, spread so lanes open
export const SLOW_MS = 4000;                  // a correct answer slower than this is correct_slow

/** A · recognition (native → English) · B · picture → English · C · reverse
 *  (English → native) · D · UFO bonus: an overdue item, 3 candidates, worth 3×. */
export type RoundKind = 'A' | 'B' | 'C' | 'D';
export type Style = 'A' | 'B' | 'C';
export type Outcome = 'correct' | 'correct_slow' | 'wrong' | 'timeout';
export type DistractorRule = 'offTopic' | 'sameTopic' | 'formTrap' | 'lemma' | 'misses';

export interface WaveTier {
  approachSec: number;   // seconds for a row to come from the top all the way down to the shield line
  rule: DistractorRule;
  newPerEight: number;   // new items per 8 prompts; the rest are review
}

// The ramp is distractor quality, not just speed. There is no separate clock:
// the answer is revealed only when the words reach the shield line above the
// cannon, so approachSec is the most time a fresh row gives you. A correct shot
// buys back one row (28px), so answering within 28px ÷ (160px ÷ approachSec)
// holds ground — 2.8s in waves 1–2, 1.4s at 12+; slower answers let it creep.
const RAMP: Array<{ upTo: number; tier: WaveTier }> = [
  { upTo: 2, tier: { approachSec: 16, rule: 'offTopic', newPerEight: 4 } },
  { upTo: 5, tier: { approachSec: 13, rule: 'sameTopic', newPerEight: 3 } },
  { upTo: 8, tier: { approachSec: 11, rule: 'formTrap', newPerEight: 2 } },
  { upTo: 11, tier: { approachSec: 9, rule: 'lemma', newPerEight: 2 } },
  { upTo: Infinity, tier: { approachSec: 8, rule: 'misses', newPerEight: 1 } },
];

export function tierFor(wave: number): WaveTier {
  return RAMP.find((r) => wave <= r.upTo)!.tier;
}

// Waves rotate recognition → picture → reverse, so an item recurring across a
// session is asked from each direction.
const ROTATION: Style[] = ['A', 'B', 'C'];

export function streakMultiplier(streak: number): number {
  return streak >= 20 ? 4 : streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
}

/** Base 100 + up to 100 speed bonus (by how early in the approach), × streak
 *  multiplier, × 3 on a UFO round. Practice drops the speed bonus so the
 *  leaderboard stays honest. */
export function promptPoints(opts: { approachSec: number; elapsedSec: number; streak: number; ufo: boolean; practice: boolean }): number {
  const left = Math.max(0, 1 - opts.elapsedSec / opts.approachSec);
  const bonus = opts.practice ? 0 : Math.round(100 * left);
  return (100 + bonus) * streakMultiplier(opts.streak) * (opts.ufo ? 3 : 1);
}

export interface TileDef {
  word: ApiWord;
  lines: string[];
  correct: boolean;
}

export interface Prompt {
  kind: RoundKind;
  style: Style;           // what the cannon shows / the tiles carry (a UFO round borrows one)
  target: ApiWord;
  tiles: Array<TileDef | null>;  // COLS slots; a UFO round leaves two empty
}

export const nativeOf = (w: ApiWord, lang: LanguageCode): string | undefined => w.translations?.[lang]?.[0]?.word;

export function promptText(p: Prompt, lang: LanguageCode): string {
  return p.style === 'A' ? nativeOf(p.target, lang) ?? '' : p.style === 'C' ? p.target.english : '';
}

export function answerMode(p: Prompt): AnswerMode {
  return p.style === 'B' ? 'identification' : 'translation';
}

export interface PlanContext {
  language: LanguageCode;
  targets: ApiWord[];                    // the bin — what gets asked
  pool: ApiWord[];                       // every word the learner has met — where distractors come from
  hasPicture: (w: ApiWord) => boolean;   // picture loaded and drawable
  misses: Map<string, ApiWord>;          // missed this session (for UFO rounds and late-wave distractors)
  picsOnly: boolean;
}

// ── Distractors ────────────────────────────────────────────────────────────

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function tileText(w: ApiWord, style: Style, lang: LanguageCode): string | undefined {
  return style === 'C' ? nativeOf(w, lang) : w.english;
}

// Per-word derived strings, computed once — the seen pool can run to thousands.
const translationSets = new WeakMap<ApiWord, Set<string>>();
function translationSet(w: ApiWord, lang: LanguageCode): Set<string> {
  let set = translationSets.get(w);
  if (!set) {
    set = new Set((w.translations?.[lang] ?? []).map((t) => norm(t.word)));
    translationSets.set(w, set);
  }
  return set;
}

/** A distractor is unfair when it is also a right answer: the same English (a
 *  homograph sense), or any shared translation (best / better → mejor). */
function ambiguous(target: ApiWord, w: ApiWord, lang: LanguageCode): boolean {
  if (norm(target.english) === norm(w.english)) return true;
  const a = translationSet(target, lang);
  for (const t of translationSet(w, lang)) if (a.has(t)) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** How alike two tile strings look (0–1): edit distance plus a shared-start /
 *  shared-end bonus — llave / clave, carta / cartón. */
function formSimilarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  let s = 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1);
  if (x.length >= 3 && x.slice(0, 3) === y.slice(0, 3)) s += 0.15;
  if (x.length >= 3 && x.slice(-3) === y.slice(-3)) s += 0.1;
  return s;
}
const TRAP_MIN_SIMILARITY = 0.45;

const sharesArea = (a: ApiWord, b: ApiWord) => a.areas.some((c) => b.areas.includes(c));

const tileLines = new WeakMap<ApiWord, Partial<Record<Style, string[] | null>>>();
function makeTile(w: ApiWord, style: Style, lang: LanguageCode, correct: boolean): TileDef | null {
  let byStyle = tileLines.get(w);
  if (!byStyle) tileLines.set(w, (byStyle = {}));
  if (byStyle[style] === undefined) {
    const text = tileText(w, style, lang);
    byStyle[style] = text ? fitLines(text, TILE_TEXT_W) : null;
  }
  const lines = byStyle[style];
  return lines ? { word: w, lines, correct } : null;
}

type Cands = Array<{ w: ApiWord; tile: TileDef }>;

function candidates(target: ApiWord, style: Style, ctx: PlanContext, cache: Map<string, Cands>): Cands {
  const key = `${style}:${target.senseId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seen = new Set<string>([norm(tileText(target, style, ctx.language) ?? '')]);
  const out: Cands = [];
  for (const w of shuffle(ctx.pool)) {
    if (w.senseId === target.senseId || ambiguous(target, w, ctx.language)) continue;
    const tile = makeTile(w, style, ctx.language, false);
    if (!tile) continue;
    const k = norm(tile.lines.join(' '));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ w, tile });
  }
  cache.set(key, out);
  return out;
}

/** Order candidates by the tier's rule; the first n become the distractors. */
function rankDistractors(target: ApiWord, style: Style, rule: DistractorRule, cands: Cands, ctx: PlanContext): Cands {
  const byTopic = () => [
    ...cands.filter((c) => sharesArea(c.w, target) && c.w.partOfSpeech === target.partOfSpeech),
    ...cands.filter((c) => sharesArea(c.w, target) && c.w.partOfSpeech !== target.partOfSpeech),
    ...cands.filter((c) => !sharesArea(c.w, target) && c.w.partOfSpeech === target.partOfSpeech),
    ...cands.filter((c) => !sharesArea(c.w, target) && c.w.partOfSpeech !== target.partOfSpeech),
  ];
  const traps = (n: number) => {
    const t = tileText(target, style, ctx.language) ?? '';
    return cands
      .map((c) => ({ c, s: formSimilarity(t, c.tile.lines.join(' ')) }))
      .filter((x) => x.s >= TRAP_MIN_SIMILARITY)
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.c);
  };
  const dedupe = (list: Cands) => [...new Set(list)];
  switch (rule) {
    case 'offTopic':
      return [...cands.filter((c) => !sharesArea(c.w, target)), ...cands.filter((c) => sharesArea(c.w, target))];
    case 'sameTopic':
      return byTopic();
    case 'formTrap':
      return dedupe([...traps(1), ...byTopic()]);
    // The corpus is English-keyed, so a Spanish lemma's sibling senses would be
    // correct answers too — "other senses" becomes two form traps of the same part of speech.
    case 'lemma':
      return dedupe([...traps(2), ...byTopic()]);
    case 'misses':
      return dedupe([
        ...traps(1),
        ...cands.filter((c) => ctx.misses.has(c.w.senseId)),
        ...[...cands].sort((a, b) => (a.w.streak ?? 0) - (b.w.streak ?? 0)).slice(0, 6),
        ...byTopic(),
      ]);
  }
}

function supports(target: ApiWord, style: Style, n: number, ctx: PlanContext, cache: Map<string, Cands>): boolean {
  const native = nativeOf(target, ctx.language);
  if (style === 'A' && !native) return false;
  if (style === 'B' && !ctx.hasPicture(target)) return false;
  // An identical cognate (bar → bar) puts the answer on the cannon; only a picture can ask it.
  if (style !== 'B' && native && norm(native) === norm(target.english)) return false;
  if (!makeTile(target, style, ctx.language, true)) return false;
  return candidates(target, style, ctx, cache).length >= n;
}

function buildPrompt(
  target: ApiWord, style: Style, ufo: boolean, rule: DistractorRule, ctx: PlanContext, cache: Map<string, Cands>,
): Prompt {
  const n = ufo ? UFO_COLS.length - 1 : COLS - 1;
  const ranked = rankDistractors(target, style, rule, candidates(target, style, ctx, cache), ctx);
  const tiles = shuffle([makeTile(target, style, ctx.language, true)!, ...ranked.slice(0, n).map((c) => c.tile)]);
  const slots: Array<TileDef | null> = Array(COLS).fill(null);
  (ufo ? UFO_COLS : [0, 1, 2, 3, 4]).forEach((col, i) => { slots[col] = tiles[i]; });
  return { kind: ufo ? 'D' : style, style, target, tiles: slots };
}

const MIN_DISTINCT_TARGETS = 3;

/** The wave's style: the rotation's pick when enough targets support it, else the
 *  next one that does. PICS ONLY reviews pictures, so it stays on B when it can. */
function waveStyle(wave: number, ctx: PlanContext, cache: Map<string, Cands>): Style | null {
  const start = ROTATION.indexOf(ctx.picsOnly ? 'B' : ROTATION[(wave - 1) % ROTATION.length]);
  const need = Math.min(MIN_DISTINCT_TARGETS, ctx.targets.length);
  for (let i = 0; i < ROTATION.length; i++) {
    const style = ROTATION[(start + i) % ROTATION.length];
    if (ctx.targets.filter((t) => supports(t, style, COLS - 1, ctx, cache)).length >= need) return style;
  }
  return null;
}

/** Plan one wave: `count` prompts in the wave's style, new/review mixed per the
 *  tier, lower-streak items weighted up, never the same item twice in a row.
 *  With `ufo`, one mid-wave prompt becomes a UFO round on an overdue item. */
export function planWave(wave: number, count: number, ctx: PlanContext, ufo: boolean): { style: Style; prompts: Prompt[] } | null {
  const cache = new Map<string, Cands>();
  const style = waveStyle(wave, ctx, cache);
  if (!style) return null;
  const tier = tierFor(wave);
  const supported = ctx.targets.filter((t) => supports(t, style, COLS - 1, ctx, cache));
  const fresh = supported.filter((t) => (t.streak ?? 0) === 0);
  const review = supported.filter((t) => (t.streak ?? 0) > 0);
  const newCount = Math.round((tier.newPerEight / 8) * count);
  const slots = shuffle([...Array(newCount).fill('new'), ...Array(count - newCount).fill('review')]);
  const maxUses = Math.ceil(count / supported.length);
  const uses = new Map<string, number>();
  const ufoAt = ufo && count >= 4 ? 2 + Math.floor(Math.random() * (count - 3)) : -1;

  const prompts: Prompt[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i++) {
    if (i === ufoAt) {
      const d = ufoPrompt(ctx, cache, prev, tier.rule);
      if (d) {
        prompts.push(d);
        prev = d.target.senseId;
        continue;
      }
    }
    const open = (list: ApiWord[]) => list.filter((w) => w.senseId !== prev && (uses.get(w.senseId) ?? 0) < maxUses);
    const first = slots[i] === 'new' ? fresh : review;
    const second = slots[i] === 'new' ? review : fresh;
    const pickFrom = [open(first), open(second), supported.filter((w) => w.senseId !== prev), supported].find((l) => l.length > 0)!;
    const target = weightedPick(pickFrom, prev);
    uses.set(target.senseId, (uses.get(target.senseId) ?? 0) + 1);
    prev = target.senseId;
    prompts.push(buildPrompt(target, style, false, tier.rule, ctx, cache));
  }
  return { style, prompts };
}

/** A UFO round asks an overdue item — one missed this session first, else the
 *  lowest-streak item in the bin — in any style it supports. */
function ufoPrompt(ctx: PlanContext, cache: Map<string, Cands>, prev: string | null, rule: DistractorRule): Prompt | null {
  const need = UFO_COLS.length - 1;
  const styles = (w: ApiWord) => ROTATION.filter((s) => supports(w, s, need, ctx, cache));
  const missed = shuffle([...ctx.misses.values()]).filter((w) => w.senseId !== prev && styles(w).length > 0);
  const lowest = [...ctx.targets]
    .filter((w) => w.senseId !== prev && styles(w).length > 0)
    .sort((a, b) => (a.streak ?? 0) - (b.streak ?? 0));
  const target = missed[0] ?? lowest[0];
  if (!target) return null;
  const options = styles(target);
  return buildPrompt(target, options[Math.floor(Math.random() * options.length)], true, rule, ctx, cache);
}
