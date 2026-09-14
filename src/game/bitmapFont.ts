// A proportional 5×7 bitmap font for the Space Invaders canvas.
//
// Every glyph sits in an 11-row cell: rows 0–1 are the accent row the doc calls
// for (diacritics over capitals), rows 2–8 the 7-row cap height, rows 4–8 the
// lowercase x-height (accents over lowercase use rows 2–3), rows 9–10 descenders.
// Glyph art below starts at row 2. Accented letters are composed at runtime from
// the NFD base + mark, so á é í ó ú ñ ü ç à â ã … all render without drawing each.
// Characters with no glyph fall back to their NFD base, then to '?'.

export const LINE_H = 11;
const SPACING = 1;

const GLYPHS: Record<string, string[]> = {
  // ── Uppercase (rows 2–8) ──
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

  // ── Lowercase (rows 2–10; x-height rows 4–8) ──
  a: ['....', '....', '.##.', '...#', '.###', '#..#', '.###'],
  b: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.'],
  c: ['....', '....', '.###', '#...', '#...', '#...', '.###'],
  d: ['...#', '...#', '.###', '#..#', '#..#', '#..#', '.###'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###'],
  f: ['.##', '#..', '###', '#..', '#..', '#..', '#..'],
  g: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '###.'],
  h: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  ı: ['.', '.', '#', '#', '#', '#', '#'], // dotless — the base for í ì î ï
  j: ['.#', '..', '.#', '.#', '.#', '.#', '.#', '.#', '#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['....', '....', '###.', '#..#', '#..#', '#..#', '#..#'],
  o: ['....', '....', '.##.', '#..#', '#..#', '#..#', '.##.'],
  p: ['....', '....', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  q: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '...#'],
  r: ['...', '...', '#.#', '##.', '#..', '#..', '#..'],
  s: ['....', '....', '.###', '#...', '.##.', '...#', '###.'],
  t: ['.#.', '.#.', '###', '.#.', '.#.', '.#.', '..#'],
  u: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###'],
  v: ['.....', '.....', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###', '...#', '###.'],
  z: ['....', '....', '####', '...#', '.##.', '#...', '####'],

  // ── Digits ──
  '0': ['.##.', '#..#', '#.##', '##.#', '#..#', '#..#', '.##.'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.##.', '#..#', '...#', '..#.', '.#..', '#...', '####'],
  '3': ['###.', '...#', '...#', '.##.', '...#', '...#', '###.'],
  '4': ['#..#', '#..#', '#..#', '####', '...#', '...#', '...#'],
  '5': ['####', '#...', '#...', '###.', '...#', '...#', '###.'],
  '6': ['.##.', '#...', '#...', '###.', '#..#', '#..#', '.##.'],
  '7': ['####', '...#', '...#', '..#.', '..#.', '.#..', '.#..'],
  '8': ['.##.', '#..#', '#..#', '.##.', '#..#', '#..#', '.##.'],
  '9': ['.##.', '#..#', '#..#', '.###', '...#', '...#', '.##.'],

  // ── Punctuation & symbols ──
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '..', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '¡': ['.', '.', '#', '.', '#', '#', '#', '#', '#'],
  '?': ['.##.', '#..#', '...#', '..#.', '.#..', '....', '.#..'],
  '¿': ['....', '....', '..#.', '....', '..#.', '.#..', '#...', '#..#', '.##.'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '’': ['#', '#', '.', '.', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '“': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '”': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '–': ['....', '....', '....', '####', '....', '....', '....'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '_': ['....', '....', '....', '....', '....', '....', '....', '####'],
  '+': ['...', '...', '.#.', '###', '.#.', '...', '...'],
  '=': ['...', '...', '###', '...', '###', '...', '...'],
  '×': ['...', '...', '#.#', '.#.', '#.#', '...', '...'],
  '/': ['..#', '..#', '.#.', '.#.', '.#.', '#..', '#..'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  ';': ['..', '..', '.#', '..', '..', '.#', '#.'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '.#', '.#', '##'],
  '<': ['...', '..#', '.#.', '#..', '.#.', '..#', '...'],
  '>': ['...', '#..', '.#.', '..#', '.#.', '#..', '...'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '&': ['.##..', '#..#.', '.##..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....'],
  '*': ['...', '#.#', '.#.', '#.#', '...', '...', '...'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
  '►': ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  '◄': ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
  '▲': ['.....', '.....', '..#..', '.###.', '#####', '.....', '.....'],
  '«': ['.....', '.....', '.#..#', '#..#.', '.#..#', '.....', '.....'],
  '»': ['.....', '.....', '#..#.', '.#..#', '#..#.', '.....', '.....'],
};

// Combining marks → a 2-row accent drawn above the base (or, for the cedilla, below).
const CEDILLA = '\u0327';
const MARKS: Record<string, string[]> = {
  '\u0301': ['.#', '#.'],     // acute
  '\u0300': ['#.', '.#'],     // grave
  '\u0302': ['.#.', '#.#'],   // circumflex
  '\u0303': ['.#.#', '#.#.'], // tilde
  '\u0308': ['#.#', '...'],   // diaeresis
  '\u030A': ['##', '##'],     // ring (approximate)
  [CEDILLA]: ['.#', '#.'],    // cedilla (drawn below)
};

interface Glyph { w: number; px: Array<[number, number]> } // [x, row]

const glyphCache = new Map<string, Glyph>();

function fromArt(art: string[]): Glyph {
  const px: Array<[number, number]> = [];
  art.forEach((line, r) => {
    for (let x = 0; x < line.length; x++) if (line[x] === '#') px.push([x, r + 2]);
  });
  return { w: art[0].length, px };
}

function composeGlyph(ch: string): Glyph {
  const nfd = ch.normalize('NFD');
  let base = nfd[0];
  const marks = [...nfd.slice(1)].filter((m) => MARKS[m]);
  if (marks.length === 0) return fromArt(GLYPHS[base] ?? GLYPHS['?']);
  if (base === 'i' && marks.some((m) => m !== CEDILLA)) base = 'ı';
  const art = GLYPHS[base];
  if (!art) return fromArt(GLYPHS['?']);
  const g = fromArt(art);
  // A base with ink in rows 2–3 (capital or ascender) takes its accent in rows
  // 0–1; x-height letters take it in rows 2–3, right on top of the bowl.
  const tall = g.px.some(([, r]) => r < 4);
  for (const m of marks) {
    const shape = MARKS[m];
    const aw = shape[0].length;
    const ox = Math.floor((g.w - aw) / 2);
    const top = m === CEDILLA ? 9 : tall ? 0 : 2;
    shape.forEach((line, r) => {
      for (let x = 0; x < line.length; x++) if (line[x] === '#') g.px.push([Math.max(0, ox + x), top + r]);
    });
  }
  return g;
}

function glyph(ch: string): Glyph {
  let g = glyphCache.get(ch);
  if (!g) {
    g = GLYPHS[ch] ? fromArt(GLYPHS[ch]) : composeGlyph(ch);
    glyphCache.set(ch, g);
  }
  return g;
}

/** Pixel width of a string at 1×. */
export function measure(text: string): number {
  let w = 0;
  let n = 0;
  for (const ch of text) {
    w += glyph(ch).w;
    n++;
  }
  return n > 0 ? w + (n - 1) * SPACING : 0;
}

// Rendered strings are cached as small 1× canvases keyed by text + colour, then
// blitted (scaled with smoothing off) — far cheaper than per-pixel fills each frame.
const textCache = new Map<string, HTMLCanvasElement>();
const TEXT_CACHE_MAX = 600;

function textCanvas(text: string, color: string): HTMLCanvasElement {
  const key = `${color}|${text}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(1, measure(text));
  c.height = LINE_H;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  let x = 0;
  for (const ch of text) {
    const gl = glyph(ch);
    for (const [px, row] of gl.px) g.fillRect(x + px, row, 1, 1);
    x += gl.w + SPACING;
  }
  if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value!);
  textCache.set(key, c);
  return c;
}

export type Align = 'left' | 'center' | 'right';

/** Draw text with its cell's top-left (row 0, the accent row) at x,y — or its
 *  centre / right edge per `align`. Coordinates snap to whole logical pixels. */
export function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string,
  scale = 1, align: Align = 'left',
) {
  if (!text) return;
  const c = textCanvas(text, color);
  const w = c.width * scale;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.drawImage(c, Math.round(left), Math.round(y), w, c.height * scale);
}

/** Lay text into at most two lines no wider than maxW (split at the space
 *  nearest the middle). Returns null when it can't fit — that item isn't tile-safe. */
export function fitLines(text: string, maxW: number): string[] | null {
  if (measure(text) <= maxW) return [text];
  const spaces: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === ' ') spaces.push(i);
  const mid = text.length / 2;
  spaces.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  for (const i of spaces) {
    const a = text.slice(0, i);
    const b = text.slice(i + 1);
    if (measure(a) <= maxW && measure(b) <= maxW) return [a, b];
  }
  return null;
}

/** Largest integer scale (≤ max) at which every line fits maxW. */
export function fitScale(lines: string[], maxW: number, max = 3): number {
  const widest = Math.max(...lines.map(measure));
  for (let s = max; s > 1; s--) if (widest * s <= maxW) return s;
  return 1;
}
