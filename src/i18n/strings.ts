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

  // Climb to Safety game
  'climb.instruction': 'Grab the correct word to climb!',
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

  // Feedback modal
  'feedback.thanks': 'Thanks for your feedback! 🙌',
  'feedback.placeholder': "What's wrong, confusing, or could be better?",
  'feedback.error': "Couldn't send — please try again.",
  'feedback.sending': 'Sending…',
  'feedback.send': 'Send feedback',

  // Accessibility / control labels
  'a11y.playSentence': 'Play sentence',
  'a11y.playWord': 'Play word',
  'a11y.replayWord': 'Replay word',
  'a11y.volume': 'Speech volume',
} as const;

export type StringKey = keyof typeof STRINGS;
