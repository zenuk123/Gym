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

## UI conventions
- Design for a 375–440 px wide iPhone first. Touch targets ≥ 44 px, inputs ≥ 16 px font (prevents iOS zoom).
- Respect safe areas (`--safe-top`, `--safe-bottom`). Bottom nav is fixed; pages pad for it.
- Colours come from tokens in `src/styles/tokens.css` (dark default + light). Use `--accent-text` for lime text/icons.
- Numeric entry: `NumberField` (decimal keypad, accepts `,`). Modal input: `Sheet` (keyboard-aware).
- Keep components small and feature code under `src/features/<area>/`. No UI library; avoid new dependencies.
