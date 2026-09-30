# Fitness OS — notes for Claude

Mobile-first fitness PWA (React 19 + TypeScript + Vite). Primary device: iPhone, installed from Safari.
The owner has **no Mac** — never introduce Xcode, Swift or Mac-only tooling. Native iOS is a far-future phase.

## Commands
- `npm test` — Vitest (Node + fake-indexeddb). `npm run typecheck`. `npm run build`.
- Run all three before committing.

## Architecture rules
- **Local-first.** UI reads IndexedDB via live queries in `src/db/hooks.ts`; never block UI on the network.
- **All writes to synced tables go through `src/db/repo.ts`** (`create` / `update` / `remove`). Never call
  `db.<table>.put` directly for synced data — it would skip the outbox and never reach the cloud.
- Deletes are soft (`deletedAt`); filter them out in queries.
- Store metric only (kg, cm, kcal, ml). Convert at the UI edge with `src/lib/units.ts`.
- Dates are local `YYYY-MM-DD` strings (`src/lib/dates.ts`), not UTC.
- Coach insights / suggestions must never change the user's targets or programme automatically.
  Label statements as fact / calculation / suggestion.

## Adding a synced table (checklist)
1. Type in `src/db/types.ts` (extends `SyncFields`), add to `SyncTableMap` and `REMOTE_TABLES`.
2. New `this.version(n)` block in `src/db/db.ts` (never edit old versions).
3. New SQL migration in `supabase/migrations/` — columns are the snake_case of every field, plus
   `user_id`, `sync_seq`, PK `(user_id, id)`, and add the table to the trigger/RLS loop.
4. Hook in `src/db/hooks.ts`, CSV/backup coverage is automatic for JSON.

## Training (Phase 2)
- Pure maths lives in `src/lib/calc/training.ts` (history index, PBs, progression, rotation, streaks) and pure
  workout editing in `src/features/workout/logic.ts`. Keep them React/DB-free and unit-tested.
- A workout stores its exercises and sets **embedded** (`Workout.exercises[].sets[]`); edit live workouts only via
  `repo.mutate` (see `features/workout/actions.ts`) so rapid taps never overwrite each other.
- Built-in exercises are seeded locally (`db/seed/exercises.ts`) with stable ids and `updatedAt: 0`; never rename an id.
- Progression suggestions only pre-fill today's sets — never modify a routine automatically.
- `useTraining()` derives everything (history, PBs, active workout) from live queries; reuse it instead of re-querying.

## Progress (Phase 3)
- Goal maths: `lib/calc/goals.ts` (profile goals are derived, user goals live in the `goals` table).
  Analytics: `lib/calc/analytics.ts`. Measurements: `lib/calc/measurements.ts`. All pure + tested.
- Progress photos: metadata syncs as rows (`photos`); image blobs live in the local-only `photoFiles` table
  and go to Supabase Storage via `syncFiles` in `sync/engine.ts`. Use `features/progress/photos/photoStore.ts`
  (`addPhoto`, `deletePhoto`, `usePhotoUrl`) — never write blobs elsewhere, never into the camera roll.
- Charts: `components/LineChart.tsx` and `components/charts/*`. Follow the dataviz rules: one hue per single
  series, 2px lines, hairline solid grids, dashed only for targets, selective labels, tooltips + `ChartTable`.
  Categorical colours must be validated (macro colours already are).

## Coach & review (Phase 6)
- AI lives in `features/coach/`. The SDK (`@anthropic-ai/sdk`) is only ever loaded with `import()` (see `claude.ts`),
  so it stays out of the main bundle. `runLoop` is a manual streaming tool loop: it validates every tool input
  (`tools.ts → validateInput`) because tools use `eager_input_streaming`, never runs tools on `refusal`/`max_tokens`,
  and echoes turns via `echoable()` (server-side fallback rules).
- Coach tools are **read-only** (`features/coach/tools.ts`). Never give the model a tool that writes; anything that
  saves (meal ideas) happens only on an explicit user tap.
- Model defaults: `claude-opus-5` with `fallbacks: 'default'` + beta `server-side-fallback-2026-07-01`; adaptive thinking,
  `effort: 'medium'`. Structured output (`output_config.format`) for meal ideas.
- AI settings (API key) live in the local `meta` table only — never add them to a synced table or backups.
- Replies must label claims `[Fact]` / `[Calculation]` / `[Suggestion]` / `[General]`; `Rich.tsx` renders the pills.
- Weekly review maths: `lib/calc/review.ts`; sleep maths: `lib/calc/sleep.ts` (pure + tested).

## Integrations (Phase 7)
- Apple Health: `lib/healthImport.ts` streams the Health `export.xml` (can be hundreds of MB — never read it whole)
  and returns weigh-ins + nights; `features/more/HealthImportPage.tsx` imports only dates not already logged,
  via `repo.createMany` (one transaction, still queued for sync).
- Shared health shape: `lib/healthData.ts` (`fromNativeSamples`, `freshOnly`); every source imports through
  `features/more/health/importHealth.ts → importHealthData` (only unlogged days; deleted days count as logged).

## Native app, wearables & reminders (Phase 7, README §5)
- Capacitor wraps `dist/`. **Never commit `ios/` or `android/`** — `.github/workflows/native.yml` runs `cap add` and
  `scripts/native/prepare.mjs` (plist/entitlements/pbxproj/manifest patches, icons from `resources/`) in the cloud.
  Change native settings in `prepare.mjs`, regenerate icons with `npm run icons`.
- Detect the shell with `pwa/platform.ts → isNative()` (no import). Capacitor plugins are loaded with `import()` only
  inside native code paths, and helpers must return the **module**, never the plugin proxy from an async function
  (a proxy resolving a promise triggers a bogus native `.then` call).
- Live Health: `features/more/health/nativeHealth.ts` (read weight + sleep only, never write).
- Wearables: `supabase/functions/wearables` (OAuth, tokens in `wearable_links` which clients can't read);
  pure normalisers in `supabase/functions/_shared/wearables.ts`. Client: `features/more/devices/wearablesApi.ts`.
- Reminders: settings in local `meta` (not synced). Native → LocalNotifications; PWA → Web Push
  (`push_subscriptions`, `supabase/functions/push`, `public/push-sw.js` imported by the Workbox SW).
  `_shared/reminders.ts` + `_shared/webpush.ts` (WebCrypto-only RFC 8291/8292) are shared with the app and tested.
- `supabase/functions/_shared/*` is included in `tsconfig.app.json`: keep it import-free and Deno-compatible.
  Call Edge Functions from the app via `sync/functions.ts → invokeFunction`.

## Friends
- Social data lives only in Supabase (`0007_friends.sql`), not in Dexie sync tables. Group reads are gated by RLS
  (`fos_shares_group`); creating/joining/leaving only via the `fos_*` RPCs.
- Users share a **summary** built on-device (`features/friends/stats.ts → buildStats/buildEvents`) filtered by their
  per-category toggles. Never publish raw logs, and never absolute body weight (percentages only).
- `features/friends/api.ts → publishIfEnabled` runs after every successful sync (registered in `main.tsx` via
  `onSynced`), only when the account is in a group; the last board is cached in `meta` for offline display.
- `db/localData.ts → loadLocalData()` is the shared read-everything helper (coach tools + friends).

## Reset & prices
- Rotation reset = `Profile.nextRoutineId` + `nextRoutineSetAt`; always call `nextRoutine(routines, workouts, rotationOverride(profile))`.
- Price book: `prices` table (user-entered, per item × shop, optional pack size). Maths in `lib/calc/prices.ts`
  (`itemKey`, whole-pack `lineCost`, `shopTotals`, `bestMix`). Never present prices as live shop prices.

## Recipes & planning
- Recipes are `SavedMeal`s with optional `image` (small JPEG data URL via `lib/image.ts → mealPhotoDataUrl`),
  `steps`, `prepMin`, `tags` (only vegetarian/vegan stored; others derived by `recipeTags`), `source`, `cover`.
- Built-in recipes: `db/seed/recipes.ts` (stable ids `recipe-<slug>`, ingredients must be built-in foods; test enforces it).
- Planner maths: `lib/calc/recipes.ts` (`autoPlan`, `swapOptions`, `filterRecipes`) — pure + tested; it only proposes.
- Don't name CSS modifier classes `card`/`hero`-style generic words on elements that aren't cards (global `.card` exists).

## Food preferences & cart export
- `Profile.foodPrefs` (questionnaire at `/nutrition/preferences`). Logic in `lib/calc/foodPrefs.ts`: `recipeFits`
  (hard rules), `scoreRecipe`/`recommend` (goal-aware ranking + readable reasons), `prefTips`, `planSettings` (feeds `autoPlan`).
- Diet/allergens/cost come from ingredient names (`lib/calc/ingredients.ts`) — keep built-in food names classifiable,
  and always tell users to check labels for allergies.
- New built-in recipes must keep `foodPrefs.test.ts` coverage passing (every diet ± gluten has options for every meal).
- Shopping export: `lib/calc/cartExport.ts` (format `fitness-os-shopping-list` v1) is the contract with
  `tools/shop_to_cart/add_to_cart.py`; change both together. The script must never check out, store credentials or
  bypass robot checks. Its tests use a local fake shop: `python -m pytest tools/shop_to_cart/tests`.

## UI conventions
- Design for a 375–440 px wide iPhone first. Touch targets ≥ 44 px, inputs ≥ 16 px font (prevents iOS zoom).
- Respect safe areas (`--safe-top`, `--safe-bottom`). Bottom nav is fixed; pages pad for it.
- Colours come from tokens in `src/styles/tokens.css` (dark default + light). Use `--accent-text` for lime text/icons.
- Numeric entry: `NumberField` (decimal keypad, accepts `,`). Modal input: `Sheet` (keyboard-aware).
- Keep components small and feature code under `src/features/<area>/`. No UI library; avoid new dependencies.
