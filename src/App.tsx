import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, Difficulty, Phase, Profile, ProgressResponse } from './types';
import { StartScreen } from './components/StartScreen';
import { MatchingTiles } from './components/MatchingTiles';
import { HearAndChoose } from './components/HearAndChoose';
import { TranslateWhatYouHear } from './components/TranslateWhatYouHear';
import { PickOne } from './components/PickOne';
import { Asteroids } from './components/Asteroids';
import { LessonComplete } from './components/LessonComplete';
import { FeedbackModal, type FeedbackContext } from './components/FeedbackModal';
import { fireConfetti } from './components/effects/Confetti';
import { playCorrect } from './lib/sound';
import { buildLesson, type Lesson, type LessonStep } from './game/lesson';
import { awardPineappleFind, completeWord, fetchBestTime, imageUrl, submitAnswer, submitFeedback, submitTime, type TimeResult } from './lib/appApi';
import { fetchPineappleChance, flushActivity, initActivityTracking, pineappleChance } from './lib/activityTime';
import { DEFAULT_CONFIG, loadGameConfig, type GameConfig } from './lib/gameConfig';
import { loadProgress, loadSave, writeProgress, writeSave, type SaveState } from './game/save';
import { parseLaunchParams } from './lib/launchParams';
import { CHALLENGES_HUB_URL } from './lib/env';
import { t } from './i18n/i18n';

function profileFromSave(s: SaveState): Profile {
  return { userId: s.userId, difficulty: s.difficulty, areas: s.areas, nativeLanguage: s.nativeLanguage, language: s.language, avatarId: s.avatarId, audio: s.audio };
}

function App() {
  // loadSave() reads localStorage synchronously — lazy-init once on mount.
  const [save] = useState(loadSave);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [error, setError] = useState<string | null>(null);
  const [savedProfile, setSavedProfile] = useState<Profile | null>(save ? profileFromSave(save) : null);
  const [lessonsCompleted, setLessonsCompleted] = useState(save?.lessonsCompleted ?? 0);
  const [levelUp, setLevelUp] = useState<Difficulty | null>(null);
  // Held here (App never unmounts) and cached to localStorage so the progress
  // bar keeps its last value across StartScreen remounts and page reloads — it
  // animates 3%→5%, not 0%→5%, each lesson.
  const [progress, setProgress] = useState<ProgressResponse | null>(loadProgress);
  // Guards the "Remove this word" button against a double-tap (per step).
  const [removedKey, setRemovedKey] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Game timer + flawless tracking, surfaced on the completion screen and sent to
  // the leaderboard. Refs (not state) so counting an answer never re-renders.
  const lessonStartRef = useRef<number | null>(null);
  const wrongCountRef = useRef(0);
  const [lessonTimeMs, setLessonTimeMs] = useState<number | null>(null);
  const [flawless, setFlawless] = useState(false);
  const [timeResult, setTimeResult] = useState<TimeResult | null>(null);
  const [rankPending, setRankPending] = useState(false);
  // Game start (state) so the countdown dial resets when a run restarts; the ref
  // mirror is what the completion timing reads.
  const [gameStartMs, setGameStartMs] = useState<number | null>(null);
  // Once an auto-started (hub deep-link) session returns to the start screen
  // (lesson finished or Quit), stop forcing the loading screen so the normal
  // start screen shows instead of a stuck "Loading…".
  const [autostartConsumed, setAutostartConsumed] = useState(false);
  // Runtime tuning (water speed, par time) fetched from /config.json on each Start,
  // plus the countdown-dial target (the leaderboard best, else the config par time).
  const [gameConfig, setGameConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [raceTargetMs, setRaceTargetMs] = useState<number>(DEFAULT_CONFIG.parTimeMs);
  const [raceLabel, setRaceLabel] = useState<'best' | 'par'>('par');

  function handleProgress(p: ProgressResponse) {
    setProgress(p);
    writeProgress(p);
  }

  const launchParams = useMemo(() => parseLaunchParams(window.location.search), []);
  const initialProfile: Partial<Profile> = { ...(savedProfile ?? {}), ...launchParams };

  // Active-usage tracking: tally idle-gated seconds from the moment the shopper's
  // id is known; reported (and reset) on finish/quit via returnToHub, and on
  // pagehide/tab-hidden by the tracker itself.
  const trackedUser = profile?.userId ?? launchParams.userId;
  // Pineapple spawn odds — driven by the shopper's 14-day active usage (all
  // activities). Seeded at the 10% floor so a slow/missing endpoint still
  // spawns occasionally; resolves well before the first climb mounts.
  const [pineappleOdds, setPineappleOdds] = useState(pineappleChance(0));
  useEffect(() => {
    if (!trackedUser) return;
    initActivityTracking(trackedUser, 'spaceinvaders');
    fetchPineappleChance(trackedUser).then(setPineappleOdds);
  }, [trackedUser]);

  // The landing hub can deep-link straight into the game with its exact selections
  // (?autostart=1 plus level/areas/audio), skipping the start screen — but only
  // when we already have the identity PLP must supply (userId/language/avatar).
  const canAutostart =
    !!launchParams.autostart &&
    !!launchParams.userId &&
    !!launchParams.language && !!launchParams.avatarId;

  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !canAutostart) return;
    autoStarted.current = true;
    startWith({
      userId: launchParams.userId!,
      difficulty: launchParams.difficulty ?? 'easy',
      areas: launchParams.areas ?? [],
      nativeLanguage: launchParams.nativeLanguage!,
      language: launchParams.language!,
      avatarId: launchParams.avatarId!,
      audio: launchParams.audio ?? true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startWith(p: Profile) {
    try {
      setError(null);
      setLevelUp(null);
      const cfg = await loadGameConfig(); // runtime tuning; no rebuild needed to change it
      setGameConfig(cfg);
      const l = await buildLesson(p, lessonsCompleted);
      setLesson(l);
      setProfile(p);
      writeSave({ ...p, lessonsCompleted, lastUpdated: Date.now() });
      // Start the game clock + reset per-game tracking and the last result.
      const startedAt = Date.now();
      lessonStartRef.current = startedAt;
      setGameStartMs(startedAt);
      wrongCountRef.current = 0;
      setLessonTimeMs(null);
      setFlawless(false);
      setTimeResult(null);
      setRankPending(false);
      // Countdown-dial target: the current best flawless time if there is one, else
      // the config par time. Fire-and-forget so a missing/slow endpoint never blocks.
      setRaceTargetMs(cfg.parTimeMs);
      setRaceLabel('par');
      if (!p.picsOnly) {
        fetchBestTime('spaceinvaders')
          .then((b) => { if (b.bestMs && b.bestMs > 0) { setRaceTargetMs(b.bestMs); setRaceLabel('best'); } })
          .catch(() => { /* no leaderboard yet → race the par time */ });
      }
      setPhase({ kind: 'challenge', index: 0 });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleAnswer(senseId: string, correct: boolean, mode: AnswerMode) {
    if (!profile) return;
    if (!correct) wrongCountRef.current += 1; // a miss or wrong answer breaks the flawless run
    try {
      const res = await submitAnswer(profile.userId, { senseId, correct, mode });
      if (res.levelAdvancedTo) {
        setLevelUp(res.levelAdvancedTo);
        setProfile((p) => (p ? { ...p, difficulty: res.levelAdvancedTo! } : p));
      }
    } catch (e) {
      // Non-fatal (e.g. 409 word no longer in bin) — keep the lesson going.
      console.warn('submitAnswer failed', e);
    }
  }

  // "I know this word" — mark the current word completed (manual completion).
  // Like handleAnswer, the answer is graded server-side and may advance a level.
  async function handleKnowWord(senseId: string) {
    if (!profile) return;
    try {
      const res = await completeWord(profile.userId, senseId);
      if (res.levelAdvancedTo) {
        setLevelUp(res.levelAdvancedTo);
        setProfile((p) => (p ? { ...p, difficulty: res.levelAdvancedTo! } : p));
      }
    } catch (e) {
      // Non-fatal (e.g. 409 word no longer in bin) — keep the lesson going.
      console.warn('completeWord failed', e);
    }
  }

  // "Remove this word from my lessons" — manual completion, then advance.
  // Confetti + a short delay before advancing so the celebration is visible.
  function handleRemoveWord(senseId: string, stepKey: string) {
    if (removedKey === stepKey) return;
    setRemovedKey(stepKey);
    handleKnowWord(senseId);
    if (profile?.audio) playCorrect();
    fireConfetti({ x: 0.5, y: 0.5 });
    window.setTimeout(onChallengeComplete, 700);
  }

  function onChallengeComplete() {
    if (phase.kind !== 'challenge' || !lesson) return;
    const nextIndex = phase.index + 1;
    if (nextIndex >= lesson.steps.length) {
      const n = lessonsCompleted + 1;
      setLessonsCompleted(n);
      if (profile) writeSave({ ...profile, lessonsCompleted: n, lastUpdated: Date.now() });
      // Total time to complete the game + whether it was flawless (no wrong answers).
      const durationMs = lessonStartRef.current ? Date.now() - lessonStartRef.current : 0;
      const isFlawless = wrongCountRef.current === 0;
      const rounds = lesson.steps.reduce((sum, s) => sum + (s.kind === 'climb' ? s.rounds.length : 1), 0);
      setLessonTimeMs(durationMs);
      setFlawless(isFlawless);
      setTimeResult(null);
      // Record to the global leaderboard (skip the stage-only PICS ONLY review).
      if (profile && !profile.picsOnly) {
        setRankPending(true);
        submitTime({ userId: profile.userId, app: 'spaceinvaders', durationMs, wrongCount: wrongCountRef.current, rounds, level: profile.difficulty })
          .then((r) => setTimeResult(r))
          .catch((e) => console.warn('submitTime failed', e))
          .finally(() => setRankPending(false));
      }
      setPhase({ kind: 'celebrate' });
      return;
    }
    setPhase({ kind: 'challenge', index: nextIndex });
  }

  // This game has no landing screen of its own — finishing a lesson or quitting
  // ALWAYS returns to the Challenges hub. Prefer history.back(): the hub launched
  // us in this same tab, so going back restores it from bfcache (instant, state
  // intact). Otherwise hard-navigate to an explicit ?callbackURL= (when PLP
  // supplied one) or the hub's known URL. Returns false only in local dev with no
  // history, so the caller can fall back in-app (the game loop stays testable
  // without a hub running).
  function returnToHub(): boolean {
    // Finish or quit — report the active-usage tally before leaving (also covers
    // the in-app dev fallback, where no pagehide would fire).
    flushActivity(true);
    if (window.history.length > 1) {
      window.history.back();
      return true;
    }
    const dest = launchParams.callbackURL ?? (import.meta.env.DEV ? null : CHALLENGES_HUB_URL);
    if (dest) {
      window.location.href = dest;
      return true;
    }
    return false;
  }

  function onCelebrationDone() {
    if (returnToHub()) return;
    setProfile(null);
    setLesson(null);
    setAutostartConsumed(true);
    setPhase({ kind: 'start' });
  }

  // Quit the current lesson — non-destructive: keeps the save, lesson count, and
  // cached progress (server-authoritative), so resume/progress persist.
  function onQuit() {
    if (returnToHub()) return;
    setProfile(null);
    setLesson(null);
    setLevelUp(null);
    setAutostartConsumed(true);
    setPhase({ kind: 'start' });
  }

  if (phase.kind === 'start') {
    // While an auto-start (hub deep link) is in flight, show loading instead of
    // flashing the landing screen. A failed lesson build sets `error` and falls
    // through to the start screen (with the error banner).
    if (canAutostart && !error && !autostartConsumed) {
      return <div className="screen"><p>{t('chrome.loading')}</p></div>;
    }
    const resumeMerged: Profile | null = savedProfile ? { ...savedProfile, ...launchParams } : null;
    return (
      <>
        {resumeMerged && !!resumeMerged.userId && profile === null && (
          <div className="resume-banner">
            <span>{t('resume.prompt')}</span>
            <button type="button" className="primary-btn small" onClick={() => startWith(resumeMerged)}>{t('resume.continue')}</button>
            <button type="button" className="ghost-btn small" onClick={() => setSavedProfile(null)}>{t('resume.startFresh')}</button>
          </div>
        )}
        <StartScreen
          initial={Object.keys(initialProfile).length > 0 ? initialProfile : undefined}
          lessonsCompleted={lessonsCompleted}
          progress={progress}
          onProgress={handleProgress}
          onStart={startWith}
        />
        {error && <div className="error-banner">{error}</div>}
      </>
    );
  }

  if (phase.kind === 'celebrate') {
    return (
      <LessonComplete
        onDone={onCelebrationDone}
        levelUp={levelUp}
        audio={profile?.audio ?? true}
        timeMs={lessonTimeMs}
        flawless={flawless}
        ranking={rankPending}
        rank={timeResult?.rank ?? null}
        totalFlawless={timeResult?.totalFlawless ?? null}
      />
    );
  }

  if (!profile || !lesson) return <div className="screen"><p>{t('chrome.loading')}</p></div>;

  const step = lesson.steps[phase.index];
  const stepKey = `${lesson.number}-${phase.index}-${step.kind}`;
  const feedbackCtx = feedbackContextFor(step);

  async function handleSubmitFeedback(message: string) {
    if (!profile) return;
    await submitFeedback({
      userId: profile.userId,
      userName: launchParams.userName,
      userEmail: launchParams.userEmail,
      challengeType: feedbackCtx.challengeType,
      challengeKind: feedbackCtx.challengeKind,
      pickMode: feedbackCtx.pickMode,
      senseId: feedbackCtx.senseId,
      word: feedbackCtx.word,
      pictureUrl: feedbackCtx.pictureUrl,
      sentence: feedbackCtx.sentence,
      language: profile.nativeLanguage,
      level: profile.difficulty,
      message,
    });
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          {/* A climb lesson is one self-paced step (it shows its own ledge
              counter), so the "X of N" step count only applies to legacy steps. */}
          {lesson.steps.length > 1 && (
            <span className="step-count">
              {phase.index + 1} <span className="step-count-total">{t('chrome.ofTotal', { total: lesson.steps.length })}</span>
            </span>
          )}
          <span className="step-meta">{t('chrome.lessonMeta', { n: lesson.number, label: labelForStep(step) })}</span>
        </div>
        <div className="topbar-right">
          <button type="button" className="link-btn" onClick={() => setFeedbackOpen(true)}>{t('chrome.giveFeedback')}</button>
          <button type="button" className="ghost-btn small" onClick={onQuit}>{t('chrome.quit')}</button>
        </div>
      </div>

      {/* The climb-round lesson data now plays as the Asteroids space shooter. */}
      {step.kind === 'climb' && (
        <Asteroids
          key={stepKey}
          rounds={step.rounds}
          pool={lesson.bin}
          language={profile.nativeLanguage}
          avatarId={profile.avatarId}
          audio={profile.audio}
          paused={feedbackOpen}
          config={gameConfig}
          pineappleChance={pineappleOdds}
          startTime={gameStartMs ?? undefined}
          targetMs={raceTargetMs}
          targetLabel={raceLabel}
          onRetry={() => { const now = Date.now(); lessonStartRef.current = now; setGameStartMs(now); wrongCountRef.current = 0; }}
          onAnswer={handleAnswer}
          onComplete={onChallengeComplete}
          onPineappleFound={() => void awardPineappleFind(profile.userId, 'spaceinvaders')}
        />
      )}

      {step.kind === 'match' && (
        <MatchingTiles
          key={stepKey}
          words={step.targets}
          language={profile.nativeLanguage}
          avatarId={profile.avatarId}
          audio={profile.audio}
          onAnswer={handleAnswer}
          onComplete={onChallengeComplete}
        />
      )}

      {step.kind === 'pick' && (
        <PickOne
          key={stepKey}
          mode={step.pickMode}
          target={step.target}
          pool={lesson.bin}
          language={profile.nativeLanguage}
          avatarId={profile.avatarId}
          audio={profile.audio}
          onAnswer={handleAnswer}
          onComplete={onChallengeComplete}
        />
      )}

      {step.kind === 'hearchoose' && (
        <HearAndChoose
          key={stepKey}
          sentence={step.sentence}
          distractors={lesson.bin}
          avatarId={profile.avatarId}
          onComplete={onChallengeComplete}
        />
      )}

      {step.kind === 'translate' && (
        <TranslateWhatYouHear
          key={stepKey}
          version={step.version}
          sentence={step.sentence}
          distractors={lesson.bin}
          language={profile.nativeLanguage}
          avatarId={profile.avatarId}
          onComplete={onChallengeComplete}
        />
      )}

      {/* The asteroids game paces itself (15 waves, incoming rocks), so it has
          no per-step Skip/Remove controls — only the topbar Quit. */}
      {step.kind !== 'climb' && (
        <div className="skip-bar">
          <button type="button" className="skip-btn" onClick={onChallengeComplete}>
            {t('chrome.skip')}
          </button>
          {step.kind === 'pick' && (
            <button
              type="button"
              className="skip-btn remove-word-btn"
              onClick={() => handleRemoveWord(step.target.senseId, stepKey)}
              disabled={removedKey === stepKey}
            >
              {t('chrome.removeWord')}
            </button>
          )}
        </div>
      )}

      {feedbackOpen && (
        <FeedbackModal
          context={feedbackCtx}
          onClose={() => setFeedbackOpen(false)}
          onSubmit={handleSubmitFeedback}
        />
      )}
    </>
  );
}

// Build the feedback context (challenge type + the picture/word/sentence it's
// about) from the current step.
function feedbackContextFor(step: LessonStep): FeedbackContext {
  const challengeType = labelForStep(step);
  switch (step.kind) {
    case 'climb':
      return { challengeType, challengeKind: step.kind, word: step.rounds.map((r) => r.target.english).join(', ') };
    case 'pick':
      return {
        challengeType,
        challengeKind: step.kind,
        pickMode: step.pickMode,
        senseId: step.target.senseId,
        word: step.target.english,
        pictureUrl: step.pickMode === 'imgToEn' ? (imageUrl(step.target) ?? undefined) : undefined,
      };
    case 'match':
      return { challengeType, challengeKind: step.kind, word: step.targets.map((t) => t.english).join(', ') };
    case 'hearchoose':
      return { challengeType, challengeKind: step.kind, sentence: step.sentence.english };
    case 'translate':
      return { challengeType, challengeKind: step.kind, sentence: step.sentence.english };
  }
}

function labelForStep(step: LessonStep): string {
  switch (step.kind) {
    case 'climb':
      return t('challenge.asteroids');
    case 'match':
      return t('challenge.match');
    case 'hearchoose':
      return t('challenge.hearchoose');
    case 'translate':
      return step.version === 'A' ? t('challenge.translateA') : t('challenge.translateB');
    case 'pick':
      switch (step.pickMode) {
        case 'enToNat':
          return t('challenge.pickEnToNat');
        case 'natToEn':
          return t('challenge.pickNatToEn');
        case 'defToEn':
          return t('challenge.pickDefToEn');
        case 'hearToEn':
          return t('challenge.pickHearToEn');
        case 'imgToEn':
          return t('challenge.pickImgToEn');
      }
  }
}

export default App;
