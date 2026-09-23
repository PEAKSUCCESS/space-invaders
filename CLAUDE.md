# space-invaders

**Space Attack** is a Vite + React + TypeScript vocabulary game — a clone of the Space app (`PEAKSUCCESS/space`, itself a clone of the Survival app, peakvocab-survival) — over the **peakvocab-api** corpus. The main loop is a 1978-shaped Canvas 2D arcade shooter that drills native → English vocabulary (see "The game: Space Attack" under What it does). It was called **Space Invaders** until 2026-09-23. Only the name learners see changed: the repo, the Vercel project, the app id `spaceinvaders`, the hub's activity id and the code's `invaders*` identifiers keep the old name, so scores, activity and the PeakESL admin grid carry on. The previous loop, **Asteroids**, and before it Climb to Safety, are retained in the tree. Sibling to (and lighter than) the 3D R3F hiking app.

It has its **own API identity**, separate from Space's: the app id `spaceinvaders` (leaderboard times, best time, activity tracking, pineapple finds — `App.tsx`) and `VITE_APP_NAME=SpaceInvaders` (UI-string scope).

## Repo boundary (hard rule)

**Work is restricted to THIS repo (`space-invaders`). Never edit, create, or delete files in any other repo** — notably the sibling backend `../peakvocab-api`, the `../space` repo this was cloned from, or any HQ/export repo. When a change is needed in another project (e.g. the `/api/vocab/tts` endpoint), **describe it** — exact code/diff as text — so Brad can copy/paste it into that project himself. Reading other repos for context is fine; modifying them is not.

## What it does

The app is launched by **peak-launchpad (PLP)** with the shopper's identity in the URL: `?userID=<cuid>&nativeLanguage=es&avatar=ivy` (parsed in `src/lib/launchParams.ts`; the shopper id is an **opaque CUID string** sent as **`userID`** — `userId`/`user_id` casings also accepted — and falls back to `VITE_DEV_USER_ID` for local dev). The legacy numeric `distID` is no longer sent or accepted, and the id is never coerced to a number. PLP also sends `token`/`shopperName`/`shopperEmail`/`callbackURL`/`mode`; `shopperName`/`shopperEmail` are used (→ `LaunchParams.userName`/`userEmail`, to attribute feedback) and **`callbackURL`** is the hub return URL — the app navigates back to it when a lesson is **completed or quit** (`returnToLanding` in `App.tsx`; falls back to the start screen when absent, and only http(s) URLs are accepted). `token`/`mode` are ignored. The shopper lands on the start screen (avatar header + speech bubble, **journey/progress bar**, **topic picker**, audio toggle). Level (Beginner/Intermediate/Advanced) and topics are picked here; `userId`, native language, and avatar come from PLP.

Everything is driven by the **new user-centric peakvocab-api** (see "Vocabulary source"). The API owns a per-user **20-word bin**, does **server-side streak scoring** (correct → streak +1; at streak 20 the word is `completed`, leaves the bin, a replacement is drawn; a wrong answer drops it a level), and reports **real per-level progress**. The app no longer builds lessons from a local word list — it reads the bin and submits answers.

Hitting **Start** builds a **lesson** (`src/game/lesson.ts`): one `invaders` step that plays a 7-wave Space Attack session from the bin. When it ends (cleared or out of cannons), a `LessonComplete` overlay shows Fireworks + the score and its board rank (and a level-up note if the API auto-advanced the level), then returns to the landing page — where the progress bar now reflects the live `/progress`.

### Start → lesson flow (`buildLesson` in `src/game/lesson.ts`)

1. `enrollUser({userId, nativeLanguage, avatar, level, areas})` — idempotent; first call auto-fills the 20-word bin. Avatar is lowercased on the wire (`jade`).
2. `setLevel(userId, level)` then `setAreas(userId, areas)` — apply the start-screen selections (each benches + refills the bin, keeping progress); the `setAreas` response carries the resulting **bin**.
3. Fetch the learner's full word history (`getUserWords`, non-fatal) and return one `{ kind: 'invaders', targets, pool }` step: `targets` = playable bin words (what gets asked), `pool` = bin ∪ history (where distractors come from, so every wrong tile is a word they've met). Waves are planned **at runtime** by the game, not here, because later waves depend on this session's misses.

### The game: Space Attack

Built from the Space Invaders design doc (the in-game name is `inv.title`/`challenge.invaders` in `strings.ts`). Four files, split by concern:

- `src/game/invaders.ts` — the teaching rules, no drawing: difficulty ramp (`tierFor`), round types, scoring (`promptPoints`, `streakMultiplier`), and `planWave` (targets + distractor tiles).
- `src/game/invadersEngine.ts` — `InvadersEngine`: fixed-step simulation + Canvas 2D renderer on a **320×256 logical screen** (the doc's 320×240 plus 16px for a 32px picture in the prompt bar). State machine ATTRACT → BRIEF → WAVE → WAVE CLEAR → REPORT → (BRIEF | FINAL). Tuning constants at the top.
- `src/components/SpaceInvaders.tsx` — React host: canvas sizing (whole device pixels on 1× displays, fill on DPR ≥ 2) with a **device-resolution backing store** (`ctx.setTransform` to logical units each frame — pixel art stays blocky because it's drawn in whole logical pixels, while word pictures, pre-scaled once to a 256px copy, are drawn smoothed and sharp), 60 Hz accumulator loop, keyboard/pointer/gamepad input, picture preloading, YIPEE overlay. Callbacks are read through a ref, so App re-renders never touch the engine.
- `src/game/bitmapFont.ts` — proportional 5×7 bitmap font, 11-row cell with an accent row; accented letters are composed from NFD base + mark (á é í ó ú ñ ü ç …). Any string containing a character the bitmap can't draw — **Japanese, Korean** (both have corpus translations and UI strings) or any other script — is set whole in a system CJK-capable font instead (`drawText`/`measure`/`fitLines` all switch together; `fitLines` wraps such text between characters). It stays crisp because the canvas backing store is device-resolution. Without this, a Japanese prompt rendered as `?`.

**Loop.** A 5-wide formation of word tiles descends (logical px/s); only the **front row is live**: 5 candidates, one correct for the prompt in the bar under the cannon. Move ◄ ► / Space fires, or **tap a tile** (cannon glides under it and fires) / drag in the bottom strip. There is **no separate clock** — the words only move while a prompt is live, and the answer is revealed when they **reach the shield line** right above the cannon (160px from spawn). A **correct** shot clears the row and the formation gives up one row-height (`ROW_PITCH` 28px, clamped at spawn). A **wrong** shot shakes the tile (250ms), the right tile pulses amber (600ms, ▲ marker), a fast red bomb blasts a big crater (radius 8) at a random point along the nearest standing shield, and the row clears with the ranks closing up (no ground gained). A row that **reaches the shields** (a timeout) has its answer pulsed right there, blasts a big hole (radius 12) in the nearest standing shield, and the formation falls back to the top; with no shields left it costs one of **3 cannons** instead.

**Bombs & shields.** The live row's ships **bomb the cannon** while a word is live (not in practice, and not in the first 2.5s of a wave): one drop every `SHIP_BOMB_EVERY` seconds by ramp tier (2.0s in waves 1–2 → 1.0s at 12+, ±30%), at most 5 in the air, falling at 110px/s. 60% are **aimed**: dropped from the ship closest above the cannon and angled (≤45px/s sideways) to land within ±9px of where the cannon is when they drop, so parking in one spot drills the cover above it; the rest fall straight from a random ship. The **shields are five pixel bunkers** (`SHIELD_SEGS`, 5 rows tall, one under each word column with the gaps between columns), eroded one crater at a time (`erode`, radius 2 per ship bomb). A bomb that meets bunker pixels bites a crater and stops; one that falls through a gap or a blasted hole and meets the cannon **costs a cannon** (never in practice). A lost cannon rolls back in under the **best cover left** (`bestCoverX` — the spot with the most bunker pixels over its 13px width, not a bunker's drilled-out middle) with a 2s pause in the bombing, so one hole can't take all three cannons in a row.

*Tuning notes (headless bot runs, 2 waves):* a player answering correctly in ~3s without dodging loses nothing (measured when perfect waves still repaired the shields); a player answering in ~5s with 1 miss in 4 and **never dodging** loses a cannon roughly every 25s and is out in wave 2; a player who never answers is out in ~40s. Radius-3 craters, 70%-aimed bombs every 1.6s, or flattening a whole bunker on a landing all ended the slower player's game inside wave 1. A bunker below 15% counts as destroyed; all five destroyed → shields down. Shield damage carries across waves for the whole session; a perfect wave no longer repairs them. Your own shots pass through the shields. 0 cannons → game over, which still runs the wave report and submits. All shields destroyed → descent ×1.25 until the wave ends. A queued tap-fire or in-flight bullet is cancelled when a new prompt goes live, so a shot can never grade a prompt it wasn't aimed at.

**Waves.** `waves` × `promptsPerWave` (7 × 8 = 56 exposures, ~6 min). Waves rotate **A recognition** (native → English tiles) → **B picture** (32px picture → English) → **C reverse** (English → native tiles), falling back when too few targets support a style (≥3 distinct). From wave 2 one mid-wave prompt is a **D UFO round**: an overdue item (missed this session, else lowest streak), 3 candidates in columns 0/2/4 (open lanes), worth 3×; a UFO crosses the top and shooting it drops a power-up (**SLOW** descent ×0.5 for 10s, **SCAN** removes up to two wrong answers — they fizzle to a dotted outline and shots pass through; always leaves one wrong answer — on the current word, or the next if the current one is already answered, **ECHO** speaks the prompt — audio only). Collecting one floats a plain-language note for 2.4s (`inv.*Note`). Identical cognates (bar → bar) are never asked as A/C.

**Ramp** (`RAMP` in `invaders.ts`, `approachSec` = seconds for a fresh row to reach the shields; descent = 160px ÷ that): waves 1–2 17.8s · off-topic distractors · 4 new:4 review; 3–5 14.4s · same topic (area, then part of speech) · 3:5; 6–8 12.2s · one form trap (edit distance + shared start/end, e.g. llave/clave) · 2:6; 9–11 10s · two form traps · 2:6; 12+ 8.9s · weighted to this session's misses · 1:7. A correct answer holds ground if it comes within 28px of descent (3.1s in waves 1–2, 1.6s at 12+); slower answers let the formation creep, which is the pressure. "New" = streak 0. Distractors are filtered for **ambiguity**: never the same English (homograph senses) and never a shared translation (best/better → mejor). Items whose tile text doesn't fit two lines of 54px aren't tile-safe for that style.

**Scoring.** 100 + up to 100 speed bonus (how early in `approachSec`) × streak multiplier (×2 at 5, ×3 at 10, ×4 at 20) × 3 on UFO rounds. A miss resets the streak; scores never go down. Perfect wave (no misses): +1000. The wave-clear panel says only that; the shields are not repaired.

**Grading → API.** One shot per prompt. Correct within `SLOW_MS` (4s) → `submitAnswer(correct: true)`; slower → logged `correct_slow`, scores, but **not submitted** (no promotion, no demotion). Wrong, or the row reaching the shields (`timeout`) → `submitAnswer(correct: false)`. Practice mode submits every correct. Mode: picture rounds `identification`, else `translation`. The engine also keeps a per-shot event log (`InvaderEvent`: outcome, latency, distractor ids) in the `InvadersResult` — the shape a future server `game_event` table would take; nothing sends it yet.

**Between waves** the **wave report** ("WORDS YOU MISSED · 1 OF 2") shows every missed item — wrong shot or reached the shields — as picture (64px) + native + "IN ENGLISH" + English (4s each, tap to advance after 1s, English spoken). **Attract screen**: title, marching demo tiles, HI-SCORE (max of the server board and this device's `peakvocabSpaceInvadersHiScore`), START and **PRACTICE** (the words don't descend, no speed bonus, off the leaderboard; also the accessibility mode).

**Word ships.** Each tile is drawn as a colourful alien ship (`drawTile`, `HULLS` in `invadersEngine.ts`): gold outline, a magenta / violet / teal hull that alternates by formation row, a cyan cockpit dome with glancing eyes in the 4px gap above, claws in the side gaps, and running lights on the belly that blink with the march. The word sits on a dark screen inside the hull (`TILE_TEXT_W` = 52px), so contrast doesn't depend on the hull colour. UFO rounds fly gold hulls; a wrong answer turns the hull grey with a red outline and struck corners; the right answer glows amber. Rows behind the live one are drawn at 45% opacity. Red and green are never hull colours — they mean wrong and right.

**Accessibility & safety.** Correct/wrong never by colour alone (shake, struck corners, ▲, sound). Nothing flashes above 3 Hz. `prefers-reduced-motion` disables screen shake, starfield scroll, tile shake and lateral drift. Sound effects are synthesized WebAudio (`sfx*` in `sound.ts`; the AudioContext unlocks on the first gesture).

The pineapple easter egg rides a green saucer once per game (rolled from `pineappleChance`); tapping or shooting it opens YIPEE and credits the award. Feedback from the topbar names the word currently on the cannon (`onLive` → `liveWord` in `App`).

### Retained: Asteroids (not built by `buildLesson`)

`App` still renders a `climb` step as Asteroids, but `buildLesson` no longer produces one. A `climb` step's 15 rounds are rendered by `src/components/Asteroids.tsx` as a retro Atari-style shooter on a black starfield. Round structure, clue/choice modes, streak-weighted targets, and first-pick grading are exactly the Climb rules (see the retained section below); what changed is the scene:

- **Layout:** HUD (wave counter + instruction) and the **clue** at the top of a dark panel; the space **scene** below holds the player's **ship at dead centre**, 4 **choice asteroids** (jagged white-outline polygons, slowly spinning on their axis — only the polygon spins, the word/picture stays upright) closing in **from all four screen edges**, plus `DECOY_COUNT` smaller **unlabeled decoy rocks** (varying sizes, always smaller than the choice rocks) — never graded, wave stays open, and **blasting one repairs the hull +`DECOY_HEAL` (5)** with a "+N" float over the ship. Rock sizes shrink on phones (`isSmallScreen`, ≤520px) so four choice rocks fit a narrow scene. Decoys don't home: each flies its own straight line toward a random waypoint (a pass may or may not cross the ship — it still rams on contact) and wraps around the screen edges, Atari-style. A **HULL health bar** (top-left, 100 → 0) and the countdown dial (top-right).
- **Click an asteroid → the ship rotates to aim and fires** (a tracer bullet, `BULLET_MS`). The **correct** rock breaks into `SHARD_COUNT` (8) **mini-asteroid shards** — small jagged outlines that tumble outward and float off — the word is spoken, and the wave advances after `ADVANCE_DELAY_MS`. A **wrong** rock survives and goes **glowing hot** — molten orange, `HOT_SPEED_MULT` faster, and twice the ram damage — and can't be shot again; the wave stays open until the correct rock is destroyed.
- **Asteroids home onto the centred ship from any direction** (velocity steered toward it at `HOMING_ACCEL`). A rock reaching the ship **rams it**: hull −`HIT_DAMAGE` (15), or −`HOT_DAMAGE` (30) when hot, with a flash + screen rumble; the rock is flung radially away `KNOCKBACK_PCT` to come around again. **Hull 0 → "Ship destroyed!"** overlay with Try again (fresh hull, wave 1; answers already submitted still counted). Surviving all 15 waves → `onComplete` → `LessonComplete`.
- Movement runs in a `requestAnimationFrame` loop that writes rock positions imperatively (no per-frame re-render), pausing while the feedback modal or YIPEE card is open and during the advance gap. The runtime config's **`waterRisePerSec` doubles as the drift-speed knob** here (scaled against its 0.9 default), so the same no-rebuild config tunes this game. Tuning constants sit at the top of `Asteroids.tsx`. The hidden pineapple easter egg is a **flying saucer** (neon white-outline UFO, bobbing in place) with the alien pineapple (green skin, three eyes, glowing antennae) riding plainly in its glass dome with a green glow — clicking the saucer finds it (same contract as the climb version).
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

### Score board (Space Attack)

`onInvadersComplete` in `App` counts the lesson, saves the local high score, and — unless it was a practice run or PICS ONLY — POSTs the score via `submitScore({ app: 'spaceinvaders', score, wrongCount, level })`. `LessonComplete` shows score, accuracy, and `Rank #n of N` / "🏆 New high score!". The attract HI-SCORE reads `fetchBestScore('spaceinvaders')`. The `spaceinvaders` board is a **score** board now (it was empty as a time board when this switched).

**Streak nudge.** That score row is also this game's **completion row** — PeakESL derives streak days from the completions API these leaderboard rows back. Only **after** `submitScore` resolves, `notifyActivityCompleted()` posts `{ type: 'peakvocab:activity-completed' }` (no payload) to `window.parent` when framed, so the streak pill celebrates now instead of at PeakESL's hourly sweep. Sent too early, PeakESL re-reads and finds nothing. Practice runs and PICS ONLY write no row, so they send no nudge. The retained climb path does the same after `submitTime`. (Ported from `space` ead509a, which every sibling game carries.)

### Completion timer & leaderboard (retained climb path)

`App` clocks each game (`lessonStartRef`) and counts wrong answers (`wrongCountRef`); on the final round it computes the total time + whether the run was **flawless** (no wrong answers) and POSTs them via `submitTime` (`appApi.ts`, `app: 'spaceinvaders'`). The `LessonComplete` "Great job!" screen shows the **time** and, for flawless runs, its **rank among all flawless runs** for this app (`#rank of N`, or "🏆 New best" at rank 1); non-flawless runs show a "finish with no mistakes" nudge, and the PICS ONLY review is skipped. ⚠️ The **`POST /api/app/times`** endpoint + `lesson_times` table live in **peakvocab-api** (not this repo); until they exist `submitTime` fails gracefully — the time still shows, just no rank.

During play, a **countdown dial** (`CountdownDial`, top-right of the climb scene) winds down toward the **current best flawless time** — `fetchBestTime` → **`GET /api/app/times/best?app=spaceinvaders`** (also peakvocab-api). Until that endpoint exists it races the **`parTimeMs`** from the runtime config instead (the dial's `label` shows `best` vs `par`); past the target it turns red and counts up the overage.

### Runtime tuning (config.json)

Difficulty knobs — Space Attack's `waves`, `promptsPerWave`, `descentScale` (× the words' descent speed, the speed knob) and `approachScale` (× each tier's seconds to reach the shields), plus the retained games' `waterRisePerSec`, `climbStep`, `wrongSurge`, and the dial's `parTimeMs` — are read at runtime from a JSON config (`loadGameConfig` in `src/lib/gameConfig.ts`), **not** compiled in, so they change **without a rebuild**. The default source is the bundled `public/config.json` (served at `/config.json`); set `VITE_CONFIG_URL` to fetch from an external URL instead (live, no-redeploy tuning — that host must allow CORS). `App` re-fetches on every **Start** (cache-busted), so editing the config and starting a new lesson applies the new values with no page reload; missing/invalid fields fall back to the defaults in `gameConfig.ts`. `ClimbToSafety` reads the water rise through a ref synced from the `config` prop, so it can even change mid-run.

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

### Translations (UI strings)

Every visible string goes through `t()` with its English baseline in `src/i18n/strings.ts`; translations come from the API's shared `Challenges` ui_strings set (en/es/ja/ko), which lives in **peakvocab-api**, not here. This game's keys and their four translations are kept in **`scripts/ui-strings.json`** (including the Vocab Hub's `game.spaceinvaders` tile label), published with **`VOCAB_ADMIN_TOKEN=<API_ADMIN_TOKEN> node scripts/push-ui-strings.mjs`** — stage by default, `VOCAB_API_URL=…` for prod, `--dry-run` to preview. It writes through the API's admin endpoint and only **adds** keys the live table lacks (`--force` overwrites), so edits made in PeakESL's Admin > Vocabulary are never reverted. Stage and prod are separate tables — run it for each. When adding a canvas string, add it to both `strings.ts` and `ui-strings.json`. The set is shared across games, so **check a key isn't already used with a different meaning**: `complete.highScore` is SpeedMatch's "High score to beat: {best}", which is why a new best here is `complete.newHighScore` (`complete.scoreRank`/`rankingScore` are shared on purpose).

## Stack

- Vite 8, React 19, TypeScript strict
- `three` + `@react-three/fiber` + `@react-three/drei` — installed but currently **unused** (carryover from the initial scaffold; can be removed if challenges stay 2D)
- `canvas-confetti` for confetti and fireworks bursts
- Web Speech API (`window.speechSynthesis`) directly — no library
- Canvas 2D for Space Attack (no game engine); WebAudio for its sound effects
- Plain CSS in `src/index.css`, no Tailwind / CSS-in-JS
- State: `useState` only; no Zustand / Redux / Context. Phase machine lives in `src/App.tsx`.
- Persistence: `localStorage` under key `peakvocabSpaceInvadersSave` (`src/game/save.ts`) — stores last difficulty/areas/audio + `lessonsCompleted` (instant same-device seed). A second key `peakvocabSpaceInvadersProgress` caches the last `/progress` so the bar seeds its % across remounts/reloads. **Resume is server-authoritative**: the StartScreen calls `getBin(userId)` on mount and pre-fills the shopper's last **level + topics** from the API (persisted on every Start, so it works cross-device); the shopper can still change either before Start.

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
- The fetched `ProgressResponse` is **held in `App` state and cached to `localStorage`** (key `peakvocabSpaceInvadersProgress`, `loadProgress`/`writeProgress` in `save.ts`), seeded back on mount — so it survives StartScreen remounts and page reloads and animates e.g. 3%→5% rather than flashing 0%→5%.

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

`challenge.index` indexes into `lesson.steps`. Each step is a `LessonStep` (`'invaders' | 'climb' | 'match' | 'pick' | 'hearchoose' | 'translate'`); lessons are built as a single `invaders` step, which ends via `onInvadersComplete`. When a challenge calls `onComplete`, `App` advances; overrunning the 15-step lesson increments `lessonsCompleted`, persists the save, and switches to `celebrate`, then returns to start. No inter-challenge transition.

## Feedback

Every challenge shows a small **"Give feedback"** link in the topbar (`App` chrome, so it covers all step kinds). It opens `FeedbackModal` (`src/components/FeedbackModal.tsx`), which shows the challenge type, a preview of what it's about (the **picture**, **word**, or **sentence** — `feedbackContextFor(step)` in `App`), and a textarea. Submitting calls `submitFeedback` (`src/lib/appApi.ts`) → **`POST /api/app/feedback`** (auth), which records a row in the API's `feedback` table. `userId` is **required** by the API; `userName`/`userEmail` (from PLP's `shopperName`/`shopperEmail`) are sent so each report is attributable to a person. ⚠️ That endpoint + table live in **peakvocab-api** (not this repo) — the payload shape is `FeedbackInput` in `appApi.ts`. A companion **`GET /api/app/feedback`** review endpoint (also API-side) renders the table for review.

## Stage-only "PICS ONLY" category

`src/lib/env.ts` exposes `PICS_ONLY_ENABLED`, true only in local dev, on Vercel **preview** (the `stage` branch, via `__VERCEL_ENV__` injected from `VERCEL_ENV` in `vite.config.ts`), or when `VITE_PICS_ONLY=1`. It fails closed — in a production (`main`) build the gated branch is **dead-code-eliminated**, so the category never ships to prod. When enabled, the StartScreen shows a **📷 PICS ONLY** chip; selecting it sets `Profile.picsOnly`, and `buildLesson` (gated again on `PICS_ONLY_ENABLED`) builds a **picture-waves-only** Invaders lesson (48 sampled targets, the whole set as distractors, no UFO rounds, off the board) drawn from **every pictured word in the corpus — across all areas and difficulty levels** (via `fetchPicturedWords` → **`GET /api/vocab/pictures`**, an API-side endpoint), independent of the user's bin. It skips enroll/setLevel/setAreas, so it doesn't mutate the user's data. For reviewing generated images.

## Theme & typography

Light theme with a cream background and orange accents (`src/index.css` `:root`): `--bg:#FDFAF2`, `--panel:#f4ead4`, `--accent:#EC7700`, `--tile-bg:#FFB22F`, `--tile-selected:#ffd07a`, `--text:#2a1f0a`, `--muted:#7a6a4f`. Font is **Montserrat** (Google Fonts via `<link>` in `index.html`), with system fallbacks.

## Commands

- `npm run dev` — Vite dev server on `:5194` (pinned, `strictPort`; siblings use 5186–5193 — Space is 5191)
- `npm run build` — `tsc -b && vite build` → `dist/`
- `npm run preview` — serve the build locally
- `npm run lint` — ESLint

## Deployment

Vercel — `peak-esl1` team (PeakSuccess). Deploys auto-trigger on pushes to the GitHub repo (`PEAKSUCCESS/space-invaders`) → Vercel project **`space-invaders`**. `VITE_APP_TOKEN`, `VITE_APP_NAME` (`SpaceInvaders`) and `VITE_VOCAB_API_URL` are set in the project env — Production (API `https://vocab.peaksuccess.com`), and Preview scoped to the `stage` and `demo` branches (API `https://stage-vocab.peaksuccess.com`) — so deployed writes don't 401. Branches: `main` (prod), `stage` (preview/staging) and `demo` (the JIFU demo build, at `https://space-invaders-git-demo-peak-esl1.vercel.app`).

**Branch → environment workflow** (one repo, two branches): push `stage` → Vercel **preview/staging** deploy at the stage URL `https://space-invaders-git-stage-peak-esl1.vercel.app`; push `main` → **Production** at `https://space-invaders-eta-ebon.vercel.app`. Brad's shorthand: **"Go stage"** = commit + push to `stage`; **"Go live"** = commit + push to `main`. **Never push `main` unless told "Go live."**

## Coding conventions

- The vocab corpus is **never bundled** — always fetch on demand via `src/lib/appApi.ts`.
- Don't hardcode area codes or language lists where dynamic discovery is easy. The StartScreen lists topics via `fetchAreas()`.
- All API access goes through `src/lib/appApi.ts`. Don't sprinkle `fetch` elsewhere.
- Keep components in plain React with `useState`; avoid pulling in a state library for this scope.
- TTS: use `lib/speech.ts`; don't call `speechSynthesis` elsewhere. **Words and sentences are spoken in the user's avatar voice** via `speakAvatar(text, avatarId, { lang?, rate? })` → API `GET /api/vocab/tts?avatar=&lang=&text=` (a **multilingual** ElevenLabs proxy; key stays server-side), falling back to the Web Speech voice (in the same `lang`/`rate`) on any failure. ⚠️ **Always pass `lang`** (`en` for English, `es` for native): the API pre-generates clips keyed by `(voice, lang, text)`, so a missing/mismatched `lang` misses the cache and triggers a billable, slower regen — `speakAvatar` enforces this by always sending `lang` (defaulting to `en`). The ▶ listening-slowdown is **client-side** via `audio.playbackRate` + `preservesPitch` (`opts.rate` from `slowedRate`); server `speed` is always 1.0 so one cached clip serves every speed (it may return 200 bytes or a 302 to the CDN — the `Audio` element handles both; no CORS needed since we don't `fetch()` the bytes). Plain `speak(text, lang)` (Web Speech) now only powers **tile-tap word feedback** and the avatar-voice fallback. Volume: `DEFAULT_VOLUME = 0.36`; live value from `getVolume()` / `setVolume(v)`, driven by `VolumeSlider`, persisted under `peakvocabSpaceInvadersVolume` (applied to both Web Speech utterances and the avatar-voice `Audio` element). `speakWordByWord`/`gapMsFor` are now **unused legacy** (the sentence games moved to `speakAvatar`).
- Sound effects (distinct from TTS): `src/lib/sound.ts` exposes `playCorrect()` and `playVictory()` (short clips at external URLs, volume tracks `getVolume()`). `playCorrect` fires **once per exercise, just before the celebration** (the confetti) at each challenge's success point — the ClimbToSafety correct grab, PickOne correct tile, the completing pair in MatchingTiles, the sentence-game wins, and "Remove this word"; **not** on Skip, and not on the final step (the victory trumpet covers it). `playVictory` plays on the `LessonComplete` screen. Both are gated on the audio toggle (`profile.audio`).
- `Math.random` inline in component render is flagged by `react-hooks/purity`; hide it behind a module-level helper (as `MatchingTiles.coinFlip` / `ClimbToSafety.makeHolds` / `lib/shuffle` do).
- `Profile` (`src/types.ts`) carries `userId`, `difficulty` (→ API level), `areas[]` (`[]` = all), `language`, `avatarId`, `audio`. When `audio` is false, `buildLesson` drops audio challenges.

## Deferred / future

- **Weighted `/next`** — lessons are built from `/bin` (one fetch). Word picking is now **streak-weighted client-side** in `buildRounds` (lower-streak words recur more, never the same word twice in a row); moving this to a server-side weighted `/next` is a possible later refinement.
- **3 writes per Start** (enroll + setLevel + setAreas) — can be trimmed to only-on-change later.
