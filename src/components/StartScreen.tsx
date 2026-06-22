import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AreaCode, AreaInfo, AvatarId, Difficulty, LanguageCode, Profile, ProgressResponse } from '../types';
import { avatars, avatarById } from '../data/avatars';
import { AvatarBadge } from './AvatarBadge';
import { fetchAreas, getBin, getProgress } from '../lib/appApi';
import { StreakBuckets } from './StreakBuckets';
import { PICS_ONLY_ENABLED } from '../lib/env';
import { t } from '../i18n/i18n';

// Difficulty → level-label string key (resolved at render via t()).
const levelLabel = (id: Difficulty) => t(`level.${id}`);

interface Props {
  initial?: Partial<Profile>;
  lessonsCompleted: number;
  progress: ProgressResponse | null;
  onProgress: (p: ProgressResponse) => void;
  onStart: (profile: Profile) => void | Promise<void>;
}

const LEVELS: { id: Difficulty; color: string }[] = [
  { id: 'easy', color: '#a8d5a2' },   // pastel green  — Beginner
  { id: 'medium', color: '#f5e08c' }, // pastel yellow — Intermediate
  { id: 'hard', color: '#f3a7a0' },   // pastel red    — Advanced
];

// Width (% of the bar) of the next-level "spillover cap". Stays hidden until the
// learner reaches 85% of their level, then grows 15% → 30% as they near 100% —
// a teaser that the next level is coming. No cap when there is no next level.
function capWidth(pct: number, hasNext: boolean): number {
  if (!hasNext || pct < 85) return 0;
  return Math.min(30, 15 + (pct - 85));
}

export function StartScreen({ initial, lessonsCompleted, progress, onProgress, onStart }: Props) {
  const userId = initial?.userId ?? 0;
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'easy');
  const [areas, setAreas] = useState<AreaCode[]>(initial?.areas ?? []);
  const [language] = useState<LanguageCode | undefined>(initial?.language);
  const [avatarId] = useState<AvatarId | undefined>(initial?.avatarId ?? avatars[0].id);
  const [audio, setAudio] = useState<boolean>(initial?.audio ?? true);
  const [picsOnly, setPicsOnly] = useState(false); // stage-only review mode
  const [starting, setStarting] = useState(false);

  const [areaList, setAreaList] = useState<AreaInfo[] | null>(null);
  const [areaError, setAreaError] = useState<string | null>(null);
  // True once the server confirms this user exists (getBin resolved). Drives the
  // progress bar so it shows for enrolled returning users even when the local
  // lessonsCompleted counter is 0 (fresh device, cleared storage, or after a
  // "Restart Lesson" wiped the save).
  const [enrolled, setEnrolled] = useState(false);

  // Bar pixel width — to decide whether the % label fits inside the coloured fill.
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarWidth(el.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Area picker source (no auth). Pass the native language to get translated
  // topic names (English fallback per area).
  useEffect(() => {
    let cancelled = false;
    fetchAreas(language)
      .then((list) => !cancelled && setAreaList(list))
      .catch((e) => {
        if (cancelled) return;
        setAreaList([]);
        setAreaError((e as Error).message);
      });
    return () => { cancelled = true; };
  }, [language]);

  // Resume the shopper's last level + topics from the server (authoritative and
  // cross-device — they're persisted on every Start). The localStorage seed
  // above shows instantly; this corrects it. A new/unenrolled user 404s here,
  // so we keep the defaults. The shopper can still change either before Start.
  useEffect(() => {
    if (userId <= 0) return;
    let cancelled = false;
    getBin(userId)
      .then((b) => {
        if (cancelled) return;
        setEnrolled(true);
        if (b.level) setDifficulty(b.level);
        if (Array.isArray(b.areas)) setAreas(b.areas);
      })
      .catch(() => { /* not enrolled yet — keep defaults */ });
    return () => { cancelled = true; };
  }, [userId]);

  // Real per-level progress — only once the shopper has finished a lesson (and
  // is therefore enrolled). Previewed against the currently-selected areas.
  // Lifted to App, so on a refetch we keep the last value (animating to the new
  // one) rather than flashing 0; on error we leave the last value in place.
  useEffect(() => {
    if (userId <= 0 || (lessonsCompleted <= 0 && !enrolled)) return;
    let cancelled = false;
    getProgress(userId, areas)
      .then((p) => !cancelled && onProgress(p))
      .catch(() => { /* keep the last-known percentage */ });
    return () => { cancelled = true; };
  }, [userId, areas, lessonsCompleted, enrolled, onProgress]);

  const currentAvatar = avatarById(avatarId ?? avatars[0].id);
  const ready = userId > 0 && !!language && !!avatarId;

  const selectedIndex = Math.max(0, LEVELS.findIndex((l) => l.id === difficulty));
  const goPrev = () => selectedIndex > 0 && setDifficulty(LEVELS[selectedIndex - 1].id);
  const goNext = () => selectedIndex < LEVELS.length - 1 && setDifficulty(LEVELS[selectedIndex + 1].id);

  const pctFor = (id: Difficulty) => progress?.levels.find((l) => l.level === id)?.percent ?? 0;
  const showPct = lessonsCompleted > 0 || enrolled || progress != null;
  const currentLevel = LEVELS[selectedIndex];
  const nextLevel = LEVELS[selectedIndex + 1] ?? null;
  const selectedPct = pctFor(currentLevel.id);
  const fillPct = Math.min(100, Math.max(0, selectedPct));
  const capPct = showPct ? capWidth(selectedPct, !!nextLevel) : 0;

  // The % is computed only over the selected topics, so it shifts when topics
  // change — spell out which topics it covers so that isn't mistaken for a drop.
  // Topic name in the native language when present, else English.
  const areaDisplay = (a: AreaInfo): string => (language ? a.translations?.[language] : undefined) ?? a.english;
  const areaName = (code: AreaCode): string => {
    const a = areaList?.find((x) => x.code === code);
    return a ? areaDisplay(a) : code;
  };
  const scopeLabel =
    areas.length === 0
      ? t('progress.scopeAll')
      : t('progress.scopeIn', { topics: areas.map((c) => `"${areaName(c)}"`).join(', ') });

  // Place the % label inside the coloured fill when it's wide enough to hold it;
  // otherwise just to the right of the fill, on the track.
  const pctText = `${Math.round(selectedPct)}%`;
  const pctInside = barWidth * (fillPct / 100) >= pctText.length * 9 + 18;

  const toggleArea = (code: AreaCode) =>
    setAreas((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  return (
    <div className="screen start-screen">
      <div className="avatar-header">
        <AvatarBadge avatar={currentAvatar} size={120} />
        <div className="speech-bubble">{t('app.welcome')}</div>
      </div>

      {userId > 0 && <StreakBuckets userId={userId} language={language} />}

      <Section title={t('start.yourProgress')}>
        <div className="journey">
          {showPct && (
            <div className="journey-avatar" style={{ left: `${fillPct}%` }}>
              <img src="/hiker.png" alt="" className="journey-hiker" />
            </div>
          )}
          <div className="journey-bar" ref={barRef}>
            <div className="journey-fill" style={{ width: `${fillPct}%`, background: currentLevel.color }} />
            {capPct > 0 && nextLevel && (
              <div className="journey-cap" style={{ width: `${capPct}%`, background: nextLevel.color }} />
            )}
            {showPct && <span className="journey-bar-scope"><span>{scopeLabel}</span></span>}
            {showPct && (
              <span
                className={`journey-bar-pct${pctInside ? ' inside' : ' outside'}`}
                style={pctInside ? { right: `calc(${100 - fillPct}% + 8px)` } : { left: `calc(${fillPct}% + 8px)` }}
              >
                {pctText}
              </span>
            )}
          </div>
          <div className="journey-labels">
            <span className="journey-label active">{levelLabel(currentLevel.id)}</span>
            {capPct > 0 && nextLevel && <span className="journey-label next">{levelLabel(nextLevel.id)} ▶</span>}
          </div>
        </div>

        <div className="journey-nav">
          <button type="button" className="ghost-btn small" disabled={selectedIndex <= 0} onClick={goPrev}>
            {t('start.previous')}
          </button>
          <span className="journey-selected">{t('progress.practicing', { level: levelLabel(LEVELS[selectedIndex].id) })}</span>
          <button type="button" className="ghost-btn small" disabled={selectedIndex >= LEVELS.length - 1} onClick={goNext}>
            {t('start.next')}
          </button>
        </div>
      </Section>

      <Section title={t('start.topics')}>
        {areaList === null ? (
          <p className="muted">{t('start.loadingTopics')}</p>
        ) : areaList.length === 0 ? (
          <p className="muted">{areaError ?? t('start.noTopics')}</p>
        ) : (
          <>
            <div className="area-grid">
              {areaList.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  className={`area-chip${areas.includes(a.code) ? ' selected' : ''}`}
                  onClick={() => toggleArea(a.code)}
                >
                  {areaDisplay(a)}
                </button>
              ))}
            </div>
            <p className="muted small">{areas.length === 0 ? t('topics.all') : t('topics.selected', { count: areas.length })}</p>
          </>
        )}
        {PICS_ONLY_ENABLED && (
          <div className="pics-only-row">
            <button
              type="button"
              className={`area-chip pics-only-chip${picsOnly ? ' selected' : ''}`}
              onClick={() => setPicsOnly((v) => !v)}
            >
              {t('start.picsOnly')}
            </button>
            <span className="muted small">{t('start.picsOnlyHint')}</span>
          </div>
        )}
      </Section>

      <Section title={t('start.audioSection')}>
        <label className="toggle">
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <span className="toggle-label">{audio ? t('start.audioOn') : t('start.audioOff')}</span>
        </label>
      </Section>

      {userId <= 0 && (
        <p className="muted">{t('start.missingUser')}</p>
      )}

      <button
        type="button"
        className="primary-btn"
        disabled={!ready || starting}
        onClick={async () => {
          if (!ready || starting) return;
          setStarting(true);
          try {
            await onStart({ userId, difficulty, areas, language: language!, avatarId: avatarId!, audio, picsOnly: PICS_ONLY_ENABLED && picsOnly });
          } finally {
            // On success App unmounts this screen; on error it stays, so re-enable.
            setStarting(false);
          }
        }}
      >
        {starting ? (
          <>
            <span className="btn-spinner" aria-hidden="true" />
            {t('start.starting')}
          </>
        ) : (
          t('start.start')
        )}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
