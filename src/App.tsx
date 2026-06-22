import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerMode, Difficulty, Phase, Profile, ProgressResponse } from './types';
import { StartScreen } from './components/StartScreen';
import { MatchingTiles } from './components/MatchingTiles';
import { HearAndChoose } from './components/HearAndChoose';
import { TranslateWhatYouHear } from './components/TranslateWhatYouHear';
import { PickOne } from './components/PickOne';
import { ClimbToSafety } from './components/ClimbToSafety';
import { LessonComplete } from './components/LessonComplete';
import { FeedbackModal, type FeedbackContext } from './components/FeedbackModal';
import { fireConfetti } from './components/effects/Confetti';
import { playCorrect } from './lib/sound';
import { buildLesson, type Lesson, type LessonStep } from './game/lesson';
import { completeWord, imageUrl, submitAnswer, submitFeedback, submitTime, type TimeResult } from './lib/appApi';
import { loadProgress, loadSave, writeProgress, writeSave, type SaveState } from './game/save';
import { parseLaunchParams } from './lib/launchParams';
import { t } from './i18n/i18n';

function profileFromSave(s: SaveState): Profile {
  return { userId: s.userId, difficulty: s.difficulty, areas: s.areas, language: s.language, avatarId: s.avatarId, audio: s.audio };
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
  // Once an auto-started (hub deep-link) session returns to the start screen
  // (lesson finished or Quit), stop forcing the loading screen so the normal
  // start screen shows instead of a stuck "Loading…".
  const [autostartConsumed, setAutostartConsumed] = useState(false);

  function handleProgress(p: ProgressResponse) {
    setProgress(p);
    writeProgress(p);
  }

  const launchParams = useMemo(() => parseLaunchParams(window.location.search), []);
  const initialProfile: Partial<Profile> = { ...(savedProfile ?? {}), ...launchParams };

  // The landing hub can deep-link straight into the game with its exact selections
  // (?autostart=1 plus level/areas/audio), skipping the start screen — but only
  // when we already have the identity PLP must supply (userId/language/avatar).
  const canAutostart =
    !!launchParams.autostart &&
    !!launchParams.userId && launchParams.userId > 0 &&
    !!launchParams.language && !!launchParams.avatarId;

  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !canAutostart) return;
    autoStarted.current = true;
    startWith({
      userId: launchParams.userId!,
      difficulty: launchParams.difficulty ?? 'easy',
      areas: launchParams.areas ?? [],
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
      const l = await buildLesson(p, lessonsCompleted);
      setLesson(l);
      setProfile(p);
      writeSave({ ...p, lessonsCompleted, lastUpdated: Date.now() });
      // Start the game clock + reset per-game tracking and the last result.
      lessonStartRef.current = Date.now();
      wrongCountRef.current = 0;
      setLessonTimeMs(null);
      setFlawless(false);
      setTimeResult(null);
      setRankPending(false);
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
        submitTime({ userId: profile.userId, app: 'survival', durationMs, wrongCount: wrongCountRef.current, rounds, level: profile.difficulty })
          .then((r) => setTimeResult(r))
          .catch((e) => console.warn('submitTime failed', e))
          .finally(() => setRankPending(false));
      }
      setPhase({ kind: 'celebrate' });
      return;
    }
    setPhase({ kind: 'challenge', index: nextIndex });
  }

  function onCelebrationDone() {
    setProfile(null);
    setLesson(null);
    setAutostartConsumed(true);
    setPhase({ kind: 'start' });
  }

  // Quit the current lesson and return to the start screen. Non-destructive:
  // keeps the save, lesson count, and cached progress (server is authoritative
  // anyway) so the start screen still shows the learner's progress and resume.
  function onQuit() {
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
        {resumeMerged && resumeMerged.userId > 0 && profile === null && (
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
      language: profile.language,
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

      {step.kind === 'climb' && (
        <ClimbToSafety
          key={stepKey}
          rounds={step.rounds}
          pool={lesson.bin}
          language={profile.language}
          avatarId={profile.avatarId}
          audio={profile.audio}
          paused={feedbackOpen}
          onAnswer={handleAnswer}
          onComplete={onChallengeComplete}
        />
      )}

      {step.kind === 'match' && (
        <MatchingTiles
          key={stepKey}
          words={step.targets}
          language={profile.language}
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
          language={profile.language}
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
          language={profile.language}
          avatarId={profile.avatarId}
          onComplete={onChallengeComplete}
        />
      )}

      {/* The climb game paces itself (15 rounds, rising water), so it has no
          per-step Skip/Remove controls — only the topbar Quit. */}
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
      return t('challenge.climb');
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
