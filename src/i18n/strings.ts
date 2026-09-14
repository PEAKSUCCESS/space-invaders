// ── UI string catalog ────────────────────────────────────────────────────────
// Every user-facing chrome string in the app, keyed. The values here are the
// English source AND the runtime fallback: if the API has no translation for a
// key in the learner's native language, the English below is shown.
//
// `{name}` tokens are interpolated at runtime by t(key, { name: value }) — keep
// them intact (and in a sensible position) when translating.
//
// This object is the single source of truth for what needs translating; the
// same key→English list is seeded into the API's `ui_strings` table.
export const STRINGS = {
  // App / shared
  'app.welcome': "Let's build your English Vocabulary",
  'common.submit': 'Submit',
  'common.cancel': 'Cancel',

  // Start screen
  'start.yourWords': 'Your words',
  'start.yourProgress': 'Your progress',
  'start.topics': 'Topics',
  'start.loadingTopics': 'Loading topics…',
  'start.noTopics': 'No topics available.',
  'start.audioSection': 'Able to listen to words',
  'start.audioOn': 'On — include audio challenges',
  'start.audioOff': 'Off — silent challenges only',
  'start.missingUser': 'Missing user — open this from PeakESL so we can track your progress.',
  'start.starting': 'Starting Lesson',
  'start.start': 'Start',
  'start.previous': '◀ Previous',
  'start.next': 'Next ▶',
  'start.picsOnly': '📷 PICS ONLY',
  'start.picsOnlyHint': 'Stage only · image challenges only, for reviewing pictures',

  // Topics
  'topics.all': 'All topics',
  'topics.selected': '{count} selected',

  // Progress
  'progress.practicing': 'Practicing: {level}',
  'progress.scopeAll': 'Across all topics',
  'progress.scopeIn': 'In {topics}',

  // Levels (difficulty)
  'level.easy': 'Beginner',
  'level.medium': 'Intermediate',
  'level.hard': 'Advanced',

  // Streak buckets
  'buckets.learning': 'Words you are learning',
  'buckets.mastering': 'Words you are mastering',
  'buckets.mastered': 'Words you have mastered',
  'buckets.empty': 'No words here yet.',

  // Resume banner
  'resume.prompt': 'Continue as last time?',
  'resume.continue': 'Continue',
  'resume.startFresh': 'Start fresh',

  // In-lesson chrome
  'chrome.ofTotal': 'of {total}',
  'chrome.lessonMeta': 'Lesson {n} · {label}',
  'chrome.giveFeedback': 'Give feedback',
  'chrome.quit': 'Quit',
  'chrome.skip': 'Skip this one ⏭',
  'chrome.removeWord': 'Remove this word from my lessons ✓',
  'chrome.loading': 'Loading…',

  // Challenge type labels
  'challenge.invaders': 'Space Invaders',
  'challenge.asteroids': 'Asteroids',
  'challenge.climb': 'Climb to Safety',
  'challenge.match': 'Matching Tiles',
  'challenge.hearchoose': 'Hear and Choose',
  'challenge.translateA': 'Translate (native → English)',
  'challenge.translateB': 'Translate (English → native)',
  'challenge.pickEnToNat': 'Pick the Translation',
  'challenge.pickNatToEn': 'Pick the English',
  'challenge.pickDefToEn': 'Pick the Word',
  'challenge.pickHearToEn': 'Pick the Word (heard)',
  'challenge.pickImgToEn': 'Pick the Word (image)',

  // Space Invaders (drawn in the canvas bitmap font — Latin script only)
  'inv.title': 'SPACE INVADERS',
  'inv.hiScore': 'HI-SCORE',
  'inv.start': 'START',
  'inv.practice': 'PRACTICE · NO RUSH',
  'inv.controls': '◄ ► MOVE   SPACE FIRE   P PRACTICE',
  'inv.controlsTouch': 'TAP A WORD TO SHOOT IT',
  'inv.score': 'SCORE',
  'inv.wave': 'WAVE {n}/{total}',
  'inv.practiceLabel': 'PRACTICE',
  'inv.roundA': 'RECOGNITION',
  'inv.roundB': 'PICTURE',
  'inv.roundC': 'REVERSE',
  'inv.roundD': 'UFO ×3',
  'inv.briefA': 'Shoot the English word',
  'inv.briefB': 'Shoot the word for the picture',
  'inv.briefC': 'Shoot the translation',
  'inv.waveInfo': '{n} WORDS · ANSWER BEFORE THEY LAND',
  'inv.noClock': 'THE WORDS WAIT FOR YOU',
  'inv.waveClear': 'WAVE CLEAR',
  'inv.perfect': 'PERFECT WAVE +{bonus}',
  'inv.shieldsRepaired': 'SHIELDS REPAIRED',
  'inv.report': 'WAVE {n} REPORT',
  'inv.reportMissed': 'WORDS YOU MISSED · {i} OF {n}',
  'inv.inEnglish': 'IN ENGLISH',
  'inv.reportHint': 'SPACE / TAP: NEXT',
  'inv.shieldsDown': 'SHIELDS DOWN',
  'inv.slow': 'SLOW',
  'inv.scan': 'SCAN',
  'inv.echo': 'ECHO',
  'inv.slowNote': 'SLOW: HALF SPEED FOR 10 S',
  'inv.scanNote': 'SCAN: WRONG ANSWERS REMOVED',
  'inv.scanNextNote': 'SCAN: READY FOR THE NEXT WORD',
  'inv.echoNote': 'ECHO: LISTEN TO THE WORD',
  'inv.slowCorrect': 'FASTER NEXT TIME',
  'inv.cannonLost': 'CANNON LOST',
  'inv.gameOver': 'GAME OVER',
  'inv.sessionComplete': 'SESSION COMPLETE',
  'inv.newHiScore': 'NEW HI-SCORE!',
  'inv.accuracy': 'CORRECT: {pct}%',
  'inv.exposures': 'WORDS ANSWERED: {n}',
  'inv.bestStreak': 'BEST STREAK: {n} CORRECT IN A ROW',
  'inv.continue': 'SPACE / TAP TO CONTINUE',
  'inv.a11y': 'Space Invaders game. Arrow keys move, Space fires; or tap a word to shoot it.',

  // Asteroids game
  'ast.wave': 'Wave {n}/{total}',
  'ast.instruction': 'Shoot the asteroid that matches by clicking on it — before the asteroids smash your ship!',
  'ast.hull': 'HULL',
  'ast.gameOver': 'Ship destroyed!',
  'ast.gameOverHint': 'The asteroids wrecked your ship — try again.',
  'ast.retry': 'Try again',

  // Climb to Safety game
  'climb.instruction': 'Pick the match to climb above the water!',
  'climb.ledge': 'Ledge {n}/{total}',
  'climb.gameOver': 'Swept away!',
  'climb.gameOverHint': 'The water caught you — try again.',
  'climb.retry': 'Try again',

  // Challenge instructions
  'pick.clickEnglish': 'Click the correct English word',
  'match.title': 'Match the words',
  'translate.answerLabel': 'Answer:',

  // Lesson complete
  'complete.greatJob': 'Great job!',
  'complete.levelUp': 'You reached {level}! 🎉',
  'complete.time': 'Time: {time}',
  'complete.ranking': 'Ranking your time…',
  'complete.rank': 'Time rank: #{rank} of {total} flawless runs',
  'complete.bestTime': '🏆 New best flawless time!',
  'complete.notRanked': 'Finish with no mistakes to make the leaderboard.',
  'complete.gameOver': 'Game over — your progress is saved',
  'complete.score': 'Score: {score}',
  'complete.rankingScore': 'Ranking your score…',
  'complete.scoreRank': 'Rank #{rank} of {total}',
  'complete.highScore': '🏆 New high score!',
  'complete.practice': 'Practice run — not on the leaderboard',
  'complete.accuracy': '{pct}% correct · answered: {n}',

  // Feedback modal
  'feedback.thanks': 'Thanks for your feedback! 🙌',
  'feedback.placeholder': "What's wrong, confusing, or could be better?",
  'feedback.error': "Couldn't send — please try again.",
  'feedback.sending': 'Sending…',
  'feedback.send': 'Send feedback',

  // Found the hidden pineapple (YIPEE card)
  'pineapple.found':
    'Great work. Keep up the good work. The more time you spend in these games, the more often the pineapple will show up for you to find. Each time you find it, you get 1,000 tokens that can be used for learning labs, coaching clips, AI chat and Live chat.',

  // Accessibility / control labels
  'a11y.playSentence': 'Play sentence',
  'a11y.playWord': 'Play word',
  'a11y.replayWord': 'Replay word',
  'a11y.volume': 'Speech volume',
} as const;

export type StringKey = keyof typeof STRINGS;
