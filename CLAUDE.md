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
- Native wrapper, live HealthKit / Health Connect and wearables are future work (README §5): Capacitor + cloud
  macOS builds, never local Xcode.

## Friends
- Social data lives only in Supabase (`0007_friends.sql`), not in Dexie sync tables. Group reads are gated by RLS
  (`fos_shares_group`); creating/joining/leaving only via the `fos_*` RPCs.
- Users share a **summary** built on-device (`features/friends/stats.ts → buildStats/buildEvents`) filtered by their
  per-category toggles. Never publish raw logs, and never absolute body weight (percentages only).
- `features/friends/api.ts → publishIfEnabled` runs after every successful sync (registered in `main.tsx` via
  `onSynced`), only when the account is in a group; the last board is cached in `meta` for offline display.
- `db/localData.ts → loadLocalData()` is the shared read-everything helper (coach tools + friends).

## UI conventions
- Design for a 375–440 px wide iPhone first. Touch targets ≥ 44 px, inputs ≥ 16 px font (prevents iOS zoom).
- Respect safe areas (`--safe-top`, `--safe-bottom`). Bottom nav is fixed; pages pad for it.
- Colours come from tokens in `src/styles/tokens.css` (dark default + light). Use `--accent-text` for lime text/icons.
- Numeric entry: `NumberField` (decimal keypad, accepts `,`). Modal input: `Sheet` (keyboard-aware).
- Keep components small and feature code under `src/features/<area>/`. No UI library; avoid new dependencies.
