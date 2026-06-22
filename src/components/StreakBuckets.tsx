import { useEffect, useMemo, useState } from 'react';
import type { ApiWord, LanguageCode } from '../types';
import { getUserWords } from '../lib/appApi';
import { nativeDefinition } from '../lib/words';
import { WordInfo } from './WordInfo';
import { t } from '../i18n/i18n';
import type { StringKey } from '../i18n/strings';

// The streak threshold a word completes at (matches the API's scoring engine).
const COMPLETE_AT = 20;

type BucketKey = 'learning' | 'mastering' | 'mastered';

const BUCKETS: { key: BucketKey; titleKey: StringKey; color: string }[] = [
  { key: 'learning', titleKey: 'buckets.learning', color: '#a8d5a2' }, // streak 0–9
  { key: 'mastering', titleKey: 'buckets.mastering', color: '#f5e08c' }, // streak 10–19
  { key: 'mastered', titleKey: 'buckets.mastered', color: '#f3a7a0' }, // streak 20 / completed
];

// Each word lands in exactly one bucket. A `completed` word can carry ANY streak
// (a manual-complete keeps the real streak as a shadow but reads completed, e.g.
// streak 0), so key mastered on status OR streak — never streak alone.
function bucketOf(w: ApiWord): BucketKey {
  if (w.status === 'completed' || w.streak >= COMPLETE_AT) return 'mastered';
  if (w.streak >= 10) return 'mastering';
  return 'learning';
}

// Display streak, capped at the completion threshold (completed words show full).
function displayStreak(w: ApiWord): number {
  if (w.status === 'completed') return COMPLETE_AT;
  return Math.min(COMPLETE_AT, w.streak);
}

// The bucket itself: a 3D closed book seen from an angle — cream page edges on
// the top and right fore-edge, a coloured front cover with the count printed on
// it. No card behind it; the book IS the tile. One fixed number size for all.
function BookCard({ color, count }: { color: string; count: number }) {
  return (
    <svg className="streak-book" viewBox="0 0 140 152" aria-hidden="true">
      {/* top page edges (lighter cream) */}
      <polygon points="20,26 104,26 120,16 36,16" fill="#F4EBD3"
               stroke="rgba(0,0,0,0.12)" strokeWidth="1" strokeLinejoin="round" />
      {/* right fore-edge pages (shaded cream), tucked under the cover at the left */}
      <polygon points="103,26 120,16 120,126 103,136" fill="#E6DABA"
               stroke="rgba(0,0,0,0.12)" strokeWidth="1" strokeLinejoin="round" />
      {/* individual page striations on the fore-edge */}
      <g stroke="#d6c9a6" strokeWidth="1.4">
        <line x1="108.8" y1="23" x2="108.8" y2="133" />
        <line x1="112.8" y1="20.5" x2="112.8" y2="130.5" />
        <line x1="116.8" y1="18" x2="116.8" y2="128" />
      </g>
      {/* front cover */}
      <rect x="20" y="26" width="84" height="110" rx="2" fill={color}
            stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      {/* spine fold line near the binding */}
      <line x1="29" y1="30" x2="29" y2="132" stroke="rgba(0,0,0,0.16)" strokeWidth="2.5" strokeLinecap="round" />
      {/* count printed on the cover */}
      <text x="62" y="82" textAnchor="middle" dominantBaseline="central" className="streak-book-num">
        {count}
      </text>
    </svg>
  );
}

interface Props {
  userId: number;
  language?: LanguageCode;
}

export function StreakBuckets({ userId, language }: Props) {
  const [words, setWords] = useState<ApiWord[] | null>(null);
  const [open, setOpen] = useState<BucketKey | null>(null);

  // Full word history (incl. completed words that have left the bin). On any
  // error (e.g. the endpoint isn't deployed yet) we just render nothing.
  useEffect(() => {
    if (userId <= 0) return;
    let cancelled = false;
    getUserWords(userId)
      .then((ws) => !cancelled && setWords(ws))
      .catch(() => !cancelled && setWords([]));
    return () => { cancelled = true; };
  }, [userId]);

  const grouped = useMemo(() => {
    const g: Record<BucketKey, ApiWord[]> = { learning: [], mastering: [], mastered: [] };
    for (const w of words ?? []) g[bucketOf(w)].push(w);
    for (const key of Object.keys(g) as BucketKey[]) {
      g[key].sort((a, b) => displayStreak(b) - displayStreak(a) || a.english.localeCompare(b.english));
    }
    return g;
  }, [words]);

  // Nothing to show until the user has at least one word (keeps a fresh/unenrolled
  // user, or a missing endpoint, from rendering empty buckets).
  if (!words || words.length === 0) return null;

  const openList = open ? grouped[open] : null;

  return (
    <section className="section">
      <h2>{t('start.yourWords')}</h2>
      <div className="streak-buckets">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`streak-bucket${open === b.key ? ' selected' : ''}`}
            onClick={() => setOpen((cur) => (cur === b.key ? null : b.key))}
          >
            <span className="streak-book-wrap">
              <BookCard color={b.color} count={grouped[b.key].length} />
            </span>
            <span className="streak-bucket-title">{t(b.titleKey)}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="streak-list">
          {openList && openList.length > 0 ? (
            openList.map((w) => (
              <div key={w.senseId} className="streak-list-row">
                <span className="streak-list-word">
                  {w.english}
                  <WordInfo definition={nativeDefinition(w, language)} label={w.english} />
                </span>
                <span className="streak-list-streak">{displayStreak(w)} / {COMPLETE_AT}</span>
              </div>
            ))
          ) : (
            <p className="streak-list-empty">{t('buckets.empty')}</p>
          )}
        </div>
      )}
    </section>
  );
}
