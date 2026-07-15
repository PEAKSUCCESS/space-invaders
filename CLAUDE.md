# space

**Space** is a Vite + React + TypeScript vocabulary game — a clone of the Survival app (peakvocab-survival) — over the **peakvocab-api** corpus. The main loop is **"Asteroids"**, a retro Atari-style space shooter (see "The game: Asteroids" under What it does); it plays the same lesson data the Survival clone's Climb to Safety used (the climb component is retained, unrendered). Sibling to (and lighter than) the 3D R3F hiking app.

## Repo boundary (hard rule)

**Work is restricted to THIS repo (`space`). Never edit, create, or delete files in any other repo** — notably the sibling backend `../peakvocab-api`, or any HQ/export repo. When a change is needed in another project (e.g. the `/api/vocab/tts` endpoint), **describe it** — exact code/diff as text — so Brad can copy/paste it into that project himself. Reading other repos for context is fine; modifying them is not.

## What it does

The app is launched by **peak-launchpad (PLP)** with the shopper's identity in the URL: `?userID=<cuid>&nativeLanguage=es&avatar=ivy` (parsed in `src/lib/launchParams.ts`; the shopper id is an **opaque CUID string** sent as **`userID`** — `userId`/`user_id` casings also accepted — and falls back to `VITE_DEV_USER_ID` for local dev). The legacy numeric `distID` is no longer sent or accepted, and the id is never coerced to a number. PLP also sends `token`/`shopperName`/`shopperEmail`/`callbackURL`/`mode`; `shopperName`/`shopperEmail` are used (→ `LaunchParams.userName`/`userEmail`, to attribute feedback) and **`callbackURL`** is the hub return URL — the app navigates back to it when a lesson is **completed or quit** (`returnToLanding` in `App.tsx`; falls back to the start screen when absent, and only http(s) URLs are accepted). `token`/`mode` are ignored. The shopper lands on the start screen (avatar header + speech bubble, **journey/progress bar**, **topic picker**, audio toggle). Level (Beginner/Intermediate/Advanced) and topics are picked here; `userId`, native language, and avatar come from PLP.

Everything is driven by the **new user-centric peakvocab-api** (see "Vocabulary source"). The API owns a per-user **20-word bin**, does **server-side streak scoring** (correct → streak +1; at streak 20 the word is `completed`, leaves the bin, a replacement is drawn; a wrong answer drops it a level), and reports **real per-level progress**. The app no longer builds lessons from a local word list — it reads the bin and submits answers.

Hitting **Start** builds a **lesson** of `LESSON_LENGTH = 15` word challenges (`src/game/lesson.ts`) from the bin and runs them back-to-back. When all 15 finish, a `LessonComplete` overlay shows Fireworks + "Great job!" (and a level-up note if the API auto-advanced the level), then returns to the landing page — where the progress bar now reflects the live `/progress`.

### Start → lesson flow (`buildLesson` in `src/game/lesson.ts`)

1. `enrollUser({userId, nativeLanguage, avatar, level, areas})` — idempotent; first call auto-fills the 20-word bin. Avatar is lowercased on the wire (`jade`).
2. `setLevel(userId, level)` then `setAreas(userId, areas)` — apply the start-screen selections (each benches + refills the bin, keeping progress); the `setAreas` response carries the resulting **bin**.
3. Build the 15 climb rounds from the bin (`buildRounds`) — one self-paced `climb` step (`LessonStep`); the step is rendered as the **Asteroids** shooter (see next section).

### The game: Asteroids

The single `climb` step's 15 rounds are rendered by `src/components/Asteroids.tsx` as a retro Atari-style shooter on a black starfield. Round structure, clue/choice modes, streak-weighted targets, and first-pick grading are exactly the Climb rules (see the retained section below); what changed is the scene:

- **Layout:** HUD (wave counter + instruction) and the **clue** at the top of a dark panel; the space **scene** below holds the player's **ship at dead centre**, 4 **choice asteroids** (jagged white-outline polygons, slowly spinning on their axis — only the polygon spins, the word/picture stays upright) closing in **from all four screen edges**, plus `DECOY_COUNT` smaller **unlabeled decoy rocks** (varying sizes, always smaller than the choice rocks) — never graded, wave stays open, and **blasting one repairs the hull +`DECOY_HEAL` (5)** with a "+N" float over the ship. Rock sizes shrink on phones (`isSmallScreen`, ≤520px) so four choice rocks fit a narrow scene. Decoys don't home: each flies its own straight line toward a random waypoint (a pass may or may not cross the ship — it still rams on contact) and wraps around the screen edges, Atari-style. A **HULL health bar** (top-left, 100 → 0) and the countdown dial (top-right).
- **Click an asteroid → the ship rotates to aim and fires** (a tracer bullet, `BULLET_MS`). The **correct** rock breaks into `SHARD_COUNT` (8) **mini-asteroid shards** — small jagged outlines that tumble outward and float off — the word is spoken, and the wave advances after `ADVANCE_DELAY_MS`. A **wrong** rock survives and goes **glowing hot** — molten orange, `HOT_SPEED_MULT` faster, and twice the ram damage — and can't be shot again; the wave stays open until the correct rock is destroyed.
- **Asteroids home onto the centred ship from any direction** (velocity steered toward it at `HOMING_ACCEL`). A rock reaching the ship **rams it**: hull −`HIT_DAMAGE` (15), or −`HOT_DAMAGE` (30) when hot, with a flash + screen rumble; the rock is flung radially away `KNOCKBACK_PCT` to come around again. **Hull 0 → "Ship destroyed!"** overlay with Try again (fresh hull, wave 1; answers already submitted still counted). Surviving all 15 waves → `onComplete` → `LessonComplete`.
- Movement runs in a `requestAnimationFrame` loop that writes rock positions imperatively (no per-frame re-render), pausing while the feedback modal or YIPEE card is open and during the advance gap. The runtime config's **`waterRisePerSec` doubles as the drift-speed knob** here (scaled against its 0.9 default), so the same no-rebuild config tunes this game. Tuning constants sit at the top of `Asteroids.tsx`. The hidden pineapple easter egg floats in space as an **alien pineapple** (green skin, three eyes, glowing antennae; same contract as the climb version).
- **Decorative traffic** (clickable scenery, behind the rocks): the **PeakESL cruiser** — a hull emblazoned with `public/peak_logo.png` — flies **one fixed route: left → right through the upper quadrant** (`CRUISER_LANE_Y`), never crossing the player's ship; clicking it pops a **1-second card in the cruiser's own shape, larger, in the upper quadrant**, reading "PEAK ESL — Speech is Power". Small **rockets** zip through in random directions every ~5–14s; **clicking a rocket explodes it** into shards and **repairs the hull +`ROCKET_HEAL` (10)**. **Shooting stars** — small bright streaks — flash across every ~3.5–10s (not clickable). Timer-driven `Flyby` state in `Asteroids.tsx`; each removes itself after its crossing.
- **Ship damage is visible**: battle scars accumulate on the ship SVG as the hull drops (scuffs < 75, crack + embers < 50, glowing breach + dulled outline < 25); the hull number lives in the top-left HULL bar only.

### Retained: Climb to Safety (not rendered)

The previous main loop (`src/components/ClimbToSafety.tsx`, kept in the tree but no longer rendered by `App`; the rules below still define the round mechanics Asteroids inherits). The learner is a **hiker climbing a ladder** (a back-view SVG `HikerClimber` in `ClimbToSafety.tsx` — cap + backpack facing the ladder, hands on the rungs, no poles — mimicking the `public/hiker.png` palette) to stay above **water that only ever rises**:

- **Layout:** the **clue** sits at the top, the **choices** in a tile band right below it, then the climb **scene** (ladder + hiker + water) fills the rest.
- **Four modes** (`ClueKind`/`ChoiceKind` in `lesson.ts`), randomly switched per round — English is always on one side: image clue → English choices · English clue → image choices · native clue → English choices · English clue → native choices. `buildRounds` assigns each round a mode the data supports (image modes need pictured words; native modes need `translations[lang]`; image/native **choices** also need ~6 such words in the bin). 6 tiles per round, one correct. Targets are drawn **streak-weighted** (`streakWeight = max(1, COMPLETION_STREAK − streak)`) so lower-streak words recur more often and near-mastered ones less — until their streak takes them out of the bin — and **never the same word twice in a row** (`weightedPick` in `lesson.ts`).
- Picking the **correct** choice raises the hiker one step up the ladder (`climberPos += CLIMB_STEP`, a CSS `bottom` transition animates the climb), fires confetti, speaks the word, and advances after `ADVANCE_DELAY_MS`. The **first pick** of each round is graded via `onAnswer` (`identification` when an image is involved, else `translation`) — one answer per word.
- A **wrong** pick **surges the water up** (`WRONG_SURGE`; the water never recedes); the round stays open until the correct choice is picked.
- The **water only rises** — continuously at `WATER_RISE_PER_SEC` via a `requestAnimationFrame` loop that writes its height imperatively (no per-frame re-render of the tiles), pausing during the celebrate gap and while the **feedback modal** is open (`paused` prop, wired to `feedbackOpen` in `App`). Two animated SVG wave crests ride the surface.
- The water renders **in front of** the climber (z-order), so it visibly rises up his body; he is only caught when it **covers his head** (`waterPos ≥ climberPos + head-offset`, the head ≈ `CLIMBER_HEAD_PX` above the sprite's anchor, as a % of the measured scene height). Then the game ends: a "Swept away!" overlay with **Try again** (replays from the bottom; answers already submitted still counted). Surviving all 15 rounds → `onComplete` → the `LessonComplete` celebration.
- Tuning constants (`CLIMBER_START`, `CLIMB_STEP`, `CLIMBER_MAX`, `WATER_RISE_PER_SEC`, `WRONG_SURGE`) sit at the top of `ClimbToSafety.tsx`.

> The PickOne / Matching / sentence challenges described below are **retained components** (`App` still renders them per `LessonStep.kind`), but `buildLesson` currently produces only `climb` steps — they're kept for the stage-only PICS ONLY path and future challenge types.

### Completion timer & leaderboard

`App` clocks each game (`lessonStartRef`) and counts wrong answers (`wrongCountRef`); on the final round it computes the total time + whether the run was **flawless** (no wrong answers) and POSTs them via `submitTime` (`appApi.ts`, `app: 'survival'`). The `LessonComplete` "Great job!" screen shows the **time** and, for flawless runs, its **rank among all flawless runs** for this app (`#rank of N`, or "🏆 New best" at rank 1); non-flawless runs show a "finish with no mistakes" nudge, and the PICS ONLY review is skipped. ⚠️ The **`POST /api/app/times`** endpoint + `lesson_times` table live in **peakvocab-api** (not this repo); until they exist `submitTime` fails gracefully — the time still shows, just no rank.

During play, a **countdown dial** (`CountdownDial`, top-right of the climb scene) winds down toward the **current best flawless time** — `fetchBestTime` → **`GET /api/app/times/best?app=survival`** (also peakvocab-api). Until that endpoint exists it races the **`parTimeMs`** from the runtime config instead (the dial's `label` shows `best` vs `par`); past the target it turns red and counts up the overage.

### Runtime tuning (config.json)

Difficulty knobs — `waterRisePerSec`, `climbStep`, `wrongSurge`, and the dial's `parTimeMs` — are read at runtime from a JSON config (`loadGameConfig` in `src/lib/gameConfig.ts`), **not** compiled in, so they change **without a rebuild**. The default source is the bundled `public/config.json` (served at `/config.json`); set `VITE_CONFIG_URL` to fetch from an external URL instead (live, no-redeploy tuning — that host must allow CORS). `App` re-fetches on every **Start** (cache-busted), so editing the config and starting a new lesson applies the new values with no page reload; missing/invalid fields fall back to the defaults in `gameConfig.ts`. `ClimbToSafety` reads the water rise through a ref synced from the `config` prop, so it can even change mid-run.

### Challenge modes (all word-based)

Words come from the bin as `ApiWord` (`{senseId, english, definition, translations?: {<lang>: [{word, definition}]}, pictureUrl, status, streak, …}`; `translations` is an **ordered array**, index 0 is primary; only `es` is loaded today; `pictureUrl` is a relative path or null — resolve with `appApi.imageUrl(word)`, coverage fills in as images generate).

- **PickOne** — `src/components/PickOne.tsx`, one component, five `PickMode`s; each is one "prompt → pick from 8 tiles" round:
  - `enToNat` — show English word, pick the native translation. (API mode `translation`)
  - `natToEn` — show native word, pick the English word. (API mode `translation`)
  - `defToEn` — show the **native-language definition** (`translations[lang][0].definition`; never the English one, first word capitalized), pick the English word. (API mode `definition`)
  - `natToEn`/`defToEn` show a top instruction line "Click the correct English word" **in the shopper's native language** (`PICK_ENGLISH_PROMPT` map in `PickOne.tsx`, es today, English fallback).
  - `hearToEn` — TTS speaks the English word, pick the English word. (API mode `identification`; audio)
  - `imgToEn` — show the word's image (`imageUrl(word)`), pick the English word. (API mode `identification`; silent, works for any native language)
- **Matching Tiles** — `src/components/MatchingTiles.tsx`. Two columns of `pairCount = 5` tiles (English ↔ native). Click-to-select, mismatch flashes red, match confettis + fades; all pairs matched → `onComplete`. (API mode `translation`)

Each gradable interaction calls `onAnswer(senseId, correct, mode)`, which `App` forwards to `submitAnswer(userId, …)`. PickOne **grades on the first attempt** (one answer submitted per step), then lets the shopper find the right tile. Matching submits one correct `translation` answer per matched pair. `App` watches `levelAdvancedTo` on the answer response. The auto-spoken word (`hearToEn`, and `enToNat` when audio is on) is delayed `SPEAK_DELAY_MS = 500` so the screen renders before it speaks.

**Per-step controls:** every challenge shows a **Skip** button (pinned bottom-center, `.skip-bar` rendered in `App` chrome) that advances without submitting an answer (the word stays in the bin and recurs). For PickOne steps the skip-bar also shows **"Remove this word from my lessons"** (next to Skip), which calls `completeWord(userId, senseId)` (manual completion → word leaves the bin) then advances; `App`'s `handleKnowWord`/`handleRemoveWord` watch `levelAdvancedTo` on its response (guarded against double-tap by `removedKey`). Every challenge also shows a small **"Give feedback"** link in the topbar (see Feedback below).

**No-translation case:** translation/definition/matching all show native-language content, so they require `translations[lang]`. When the shopper's native language has none (anything but `es` today), only the language-agnostic challenges run — `hearToEn` (audio), `imgToEn` (silent, needs images), and `hearchoose` (audio sentences). If none are available (e.g. audio off and no images yet), `buildLesson` throws a clear "no challenges available" error. Category distribution is `floor(15/N)` per available category + remainder, then shuffled (same shape as the old builder's `buildCategorySlots`).

**Audio off** drops `hearToEn`.

### Sentence challenges

Two word-ordering games over example sentences from `GET /api/vocab/sentences` (`appApi.fetchSentences(area, difficulty, lang)` → `Sentence[]` of `{id?, english, translation?}`). They're **audio** challenges (gated on `profile.audio`), and don't submit answers (sentences aren't tied to a `senseId`):

- **HearAndChoose** — `src/components/HearAndChoose.tsx`. TTS speaks the English sentence; arrange the word tiles in spoken order. English-only, so works for any native language.
- **TranslateWhatYouHear** — `src/components/TranslateWhatYouHear.tsx`, `version: 'A' | 'B'`. A: native spoken → build the English; B: English spoken → build the native. Needs `sentence.translation` (es today).

`buildLesson` picks one of the user's areas (or one from the bin), fetches sentences for it + the level, and **length-filters** to `≤ MAX_SENTENCE_WORDS` (9) so they fit the tile UI (the corpus caps lengths per CEFR level ~5/7/9). The tile count is **dynamic** (all sentence words + a few distractors), so longer sentences still fit. If no usable sentences come back (or audio is off), the lesson stays word-only. Both components take `ApiWord[]` distractors from the bin. Sentence ▶ audio uses the **avatar voice** (`speakAvatar`) — the API TTS proxy is **multilingual** (English + native via the `lang` param), so both the English sentence games and the native-language TWYH-A line are spoken in the shopper's avatar voice. The listening-slowdown ▶ slows playback **client-side** via `audio.playbackRate` (`slowedRate`), not by regenerating audio. (Tapping a tile still gives quick word feedback via Web Speech `speak`.)

After the steps are built, `dedupeSentenceSteps` (`lesson.ts`) scans them and replaces any sentence repeated **across** the two sentence challenges (or **within** one — the two bags draw from overlapping pools) with an unused sentence from the matching pool, or a word challenge when the pool is exhausted — so one lesson never plays the same sentence twice.

## Stack

- Vite 8, React 19, TypeScript strict
- `three` + `@react-three/fiber` + `@react-three/drei` — installed but currently **unused** (carryover from the initial scaffold; can be removed if challenges stay 2D)
- `canvas-confetti` for confetti and fireworks bursts
- Web Speech API (`window.speechSynthesis`) directly — no library
- Plain CSS in `src/index.css`, no Tailwind / CSS-in-JS
- State: `useState` only; no Zustand / Redux / Context. Phase machine lives in `src/App.tsx`.
- Persistence: `localStorage` under key `peakvocabSurvivalSave` (`src/game/save.ts`) — stores last difficulty/areas/audio + `lessonsCompleted` (instant same-device seed). A second key `peakvocabSurvivalProgress` caches the last `/progress` so the bar seeds its % across remounts/reloads. **Resume is server-authoritative**: the StartScreen calls `getBin(userId)` on mount and pre-fills the shopper's last **level + topics** from the API (persisted on every Start, so it works cross-device); the shopper can still change either before Start.

## Vocabulary source

Read-only GETs and authenticated POSTs against **peakvocab-api**. Default base URL is the staging DO app (baked into `src/lib/appApi.ts` as a fallback so prod builds work without env config); override with `VITE_VOCAB_API_URL`.

- Stage: `https://peakvocab-api-stage-vkkf2.ondigitalocean.app`
- Local dev: `http://localhost:3001`

**All API access lives in `src/lib/appApi.ts`.** A user is identified by their opaque CUID `userId` (a string, never a number); every call operates only on that user's data.

- Reads (no auth): `fetchAreas()` → `GET /api/vocab/areas` (the 9 topic codes), `getBin`, `getNext`, `getProgress(userId, areas?)`.
- Writes (auth): `enrollUser`, `submitAnswer`, `completeWord`, `setLevel`, `setAreas`, `submitFeedback` — sent with `Authorization: Bearer <VITE_APP_TOKEN>`.

**`VITE_APP_TOKEN`** is the shared app token for writes. It **ships in the frontend bundle and is therefore public** (by design — low-sensitivity, rotatable). Value lives in `.env.local` (gitignored); placeholder documented in `.env.example`. Get the real value from Brad.

**Live area codes** (`GET /api/vocab/areas`): `DLF` Daily Life · `FOD` Food · `GEN` General · `GTA` Getting Around · `HLT` Health & Fitness · `HOB` Hobbies & Free Time · `MON` Money & Services · `PPL` People & Relationships · `WRK` Work & Learning.
**Translations loaded today:** `es` only (other native languages omit `translations` → English-only fallback).

## Progress bar

The "Your progress" bar shows **only the level the learner is in** (the selected `difficulty`, which defaults to the server's current level) — the whole bar is that one level, not the old three-segment journey. A **hiker marker** (`public/hiker.png`, transparent) rides at the fill head with the % label. The bar (and the `/progress` fetch) show whenever the user is **enrolled** (a resolved `getBin`), has cached progress, or `lessonsCompleted > 0` — `showPct` in `StartScreen.tsx`. (It used to gate only on `lessonsCompleted > 0`, so the bar went blank after "Restart Lesson"/on a fresh device even though the server had real progress.)

- **Percent is streak-based**: `GET /api/app/users/:id/progress` returns `levels[]` (easy/medium/hard) whose `percent` = `sum(streak over words matching area+difficulty) / (count × 20)` (a completed word counts as the full threshold). This makes the bar move a little after **every** lesson, not just when a word hits streak 20. ⚠️ That formula lives in **peakvocab-api** (`getProgress` in `src/app/engine.ts`) — the frontend only reads `levels[].percent`. If the API still returns the old completed-count percent, the bar works but only jumps when words complete.
- **Spillover cap:** at ≥85% a sliver of the **next** level's color appears at the right end and grows (15%→30% of the bar toward 100%) as a teaser — `capWidth()` in `StartScreen.tsx`. On level-up the bar relabels to the new level and the API's percent restarts low.
- The fetched `ProgressResponse` is **held in `App` state and cached to `localStorage`** (key `peakvocabSurvivalProgress`, `loadProgress`/`writeProgress` in `save.ts`), seeded back on mount — so it survives StartScreen remounts and page reloads and animates e.g. 3%→5% rather than flashing 0%→5%.

## Avatars

Static PNGs at `public/avatars/{Clay,Ivy,Jade,Reed}.png`. Until the images exist, `AvatarBadge` renders an emoji + colored fallback. `src/data/avatars.ts` lists the IDs (capitalized) and fallbacks; the API wants them lowercase (`ivy|jade|clay|reed`), so `enrollUser` lowercases on the wire.

## Phase machine

`src/App.tsx` holds:

```ts
type Phase =
  | { kind: 'start' }
  | { kind: 'challenge'; index: number }
  | { kind: 'celebrate' };
```

`challenge.index` indexes into `lesson.steps`. Each step is a `LessonStep` (`'match' | 'pick' | 'hearchoose' | 'translate'`). When a challenge calls `onComplete`, `App` advances; overrunning the 15-step lesson increments `lessonsCompleted`, persists the save, and switches to `celebrate`, then returns to start. No inter-challenge transition.

## Feedback

Every challenge shows a small **"Give feedback"** link in the topbar (`App` chrome, so it covers all step kinds). It opens `FeedbackModal` (`src/components/FeedbackModal.tsx`), which shows the challenge type, a preview of what it's about (the **picture**, **word**, or **sentence** — `feedbackContextFor(step)` in `App`), and a textarea. Submitting calls `submitFeedback` (`src/lib/appApi.ts`) → **`POST /api/app/feedback`** (auth), which records a row in the API's `feedback` table. `userId` is **required** by the API; `userName`/`userEmail` (from PLP's `shopperName`/`shopperEmail`) are sent so each report is attributable to a person. ⚠️ That endpoint + table live in **peakvocab-api** (not this repo) — the payload shape is `FeedbackInput` in `appApi.ts`. A companion **`GET /api/app/feedback`** review endpoint (also API-side) renders the table for review.

## Stage-only "PICS ONLY" category

`src/lib/env.ts` exposes `PICS_ONLY_ENABLED`, true only in local dev, on Vercel **preview** (the `stage` branch, via `__VERCEL_ENV__` injected from `VERCEL_ENV` in `vite.config.ts`), or when `VITE_PICS_ONLY=1`. It fails closed — in a production (`main`) build the gated branch is **dead-code-eliminated**, so the category never ships to prod. When enabled, the StartScreen shows a **📷 PICS ONLY** chip; selecting it sets `Profile.picsOnly`, and `buildLesson` (gated again on `PICS_ONLY_ENABLED`) builds an **image-identify-only** lesson (`imgToEn`) drawn from **every pictured word in the corpus — across all areas and difficulty levels** (via `fetchPicturedWords` → **`GET /api/vocab/pictures`**, an API-side endpoint), independent of the user's bin. It skips enroll/setLevel/setAreas, so it doesn't mutate the user's data. For reviewing generated images.

## Theme & typography

Light theme with a cream background and orange accents (`src/index.css` `:root`): `--bg:#FDFAF2`, `--panel:#f4ead4`, `--accent:#EC7700`, `--tile-bg:#FFB22F`, `--tile-selected:#ffd07a`, `--text:#2a1f0a`, `--muted:#7a6a4f`. Font is **Montserrat** (Google Fonts via `<link>` in `index.html`), with system fallbacks.

## Commands

- `npm run dev` — Vite dev server on `:5173`
- `npm run build` — `tsc -b && vite build` → `dist/`
- `npm run preview` — serve the build locally
- `npm run lint` — ESLint

## Deployment

Vercel — `peak-esl1` team (PeakSuccess). Deploys auto-trigger on pushes to the GitHub repo (`PEAKSUCCESS/peakvocab-survival`) → Vercel project **`peakvocab-survival`**. `VITE_APP_TOKEN` is set in the project env (Production, and Preview scoped to the `stage` branch) so deployed writes don't 401; add any `VITE_VOCAB_API_URL` override the same way. Branches: `main` (prod) and `stage` (preview/staging).

**Branch → environment workflow** (one repo, two branches): push `stage` → Vercel **preview/staging** deploy at the stage URL `https://peakvocab-survival-git-stage-peak-esl1.vercel.app`; push `main` → **Production** at `https://peakvocab-survival.vercel.app`. Brad's shorthand: **"Go stage"** = commit + push to `stage`; **"Go live"** = commit + push to `main`. **Never push `main` unless told "Go live."**

## Coding conventions

- The vocab corpus is **never bundled** — always fetch on demand via `src/lib/appApi.ts`.
- Don't hardcode area codes or language lists where dynamic discovery is easy. The StartScreen lists topics via `fetchAreas()`.
- All API access goes through `src/lib/appApi.ts`. Don't sprinkle `fetch` elsewhere.
- Keep components in plain React with `useState`; avoid pulling in a state library for this scope.
- TTS: use `lib/speech.ts`; don't call `speechSynthesis` elsewhere. **Words and sentences are spoken in the user's avatar voice** via `speakAvatar(text, avatarId, { lang?, rate? })` → API `GET /api/vocab/tts?avatar=&lang=&text=` (a **multilingual** ElevenLabs proxy; key stays server-side), falling back to the Web Speech voice (in the same `lang`/`rate`) on any failure. ⚠️ **Always pass `lang`** (`en` for English, `es` for native): the API pre-generates clips keyed by `(voice, lang, text)`, so a missing/mismatched `lang` misses the cache and triggers a billable, slower regen — `speakAvatar` enforces this by always sending `lang` (defaulting to `en`). The ▶ listening-slowdown is **client-side** via `audio.playbackRate` + `preservesPitch` (`opts.rate` from `slowedRate`); server `speed` is always 1.0 so one cached clip serves every speed (it may return 200 bytes or a 302 to the CDN — the `Audio` element handles both; no CORS needed since we don't `fetch()` the bytes). Plain `speak(text, lang)` (Web Speech) now only powers **tile-tap word feedback** and the avatar-voice fallback. Volume: `DEFAULT_VOLUME = 0.36`; live value from `getVolume()` / `setVolume(v)`, driven by `VolumeSlider`, persisted under `peakvocabSurvivalVolume` (applied to both Web Speech utterances and the avatar-voice `Audio` element). `speakWordByWord`/`gapMsFor` are now **unused legacy** (the sentence games moved to `speakAvatar`).
- Sound effects (distinct from TTS): `src/lib/sound.ts` exposes `playCorrect()` and `playVictory()` (short clips at external URLs, volume tracks `getVolume()`). `playCorrect` fires **once per exercise, just before the celebration** (the confetti) at each challenge's success point — the ClimbToSafety correct grab, PickOne correct tile, the completing pair in MatchingTiles, the sentence-game wins, and "Remove this word"; **not** on Skip, and not on the final step (the victory trumpet covers it). `playVictory` plays on the `LessonComplete` screen. Both are gated on the audio toggle (`profile.audio`).
- `Math.random` inline in component render is flagged by `react-hooks/purity`; hide it behind a module-level helper (as `MatchingTiles.coinFlip` / `ClimbToSafety.makeHolds` / `lib/shuffle` do).
- `Profile` (`src/types.ts`) carries `userId`, `difficulty` (→ API level), `areas[]` (`[]` = all), `language`, `avatarId`, `audio`. When `audio` is false, `buildLesson` drops audio challenges.

## Deferred / future

- **Weighted `/next`** — lessons are built from `/bin` (one fetch). Word picking is now **streak-weighted client-side** in `buildRounds` (lower-streak words recur more, never the same word twice in a row); moving this to a server-side weighted `/next` is a possible later refinement.
- **3 writes per Start** (enroll + setLevel + setAreas) — can be trimmed to only-on-change later.
