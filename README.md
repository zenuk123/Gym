# Fitness OS

A personal fitness operating system — training, nutrition and progress — built as a
**mobile-first Progressive Web App**. It installs to an iPhone Home Screen from Safari,
runs full-screen like a native app, and works offline in the gym.

No Mac, Xcode or App Store needed: build from Windows, deploy from GitHub, test on your iPhone.

## Status

### Reset & shopping prices ✅
- **Reset** on Today's workout: discard a workout in progress (with undo), or restart the programme rotation by picking
  which routine is next — history is kept, and the rotation carries on in order after you do it.
- **Price book for the shopping list:** tap **+ price** on any item and enter what it costs at your shop (Tesco, Aldi,
  a local market…), optionally with the pack size so the list works out whole packs. Prices are remembered, so each
  week's list adds itself up: total at each shop, how many items are priced there, and a **cheapest mix** (each item
  where it's cheapest). Currency in *Nutrition → Shopping → Price book*.
- These are **your** prices — UK supermarkets don't offer public price feeds, so the app never guesses live prices.
- With sync on, run migration `0008_prices_and_reset.sql`.

### Friends & leaderboard ✅
- **Groups** (*More → Friends*): start a group and tap **Invite** to send a link (or a 6-character code) to
  friends. Up to 50 people per group, and you can be in up to 10 groups. Leaving a group, or
  getting a new invite code, is one tap.
- **Leaderboard**, reset every Monday: habit score, workouts (against each person's *own* target, so 3/3 beats 4/6),
  streak, PBs this week, weight-goal progress %, and days on calorie target.
- **Activity feed:** friends' PBs (shown in *your* units), goals reached, weekly targets hit and streak milestones.
  **Today** shows your place in your group.
- **You choose what's shared**, per category. Only small summaries computed on your phone are uploaded — never your food log,
  weigh-ins, measurements, photos or sleep. **Weight is only ever shared as a percentage**, never kilograms.
  Leaving your last group deletes everything you shared.
- Needs cloud accounts (§3): every friend creates their own account in the same app. Run migration `0007_friends.sql`.

### Phase 7 — Integrations (PWA-friendly parts) ✅
- **Barcode scanner** (Nutrition → Add → scan): uses the camera with the built-in `BarcodeDetector` where available
  and a bundled decoder otherwise, looks the product up on Open Food Facts, and lets you type the number when offline.
- **Apple Health import** (*More → Data & backup → Import from Apple Health*): reads the Health app's
  "Export All Health Data" file **on the phone** (never uploaded) and adds your weight history and sleep, including
  Apple Watch sleep stages, for days you haven't logged. One weigh-in per day, one night per wake-up date,
  no double counting when both the phone and the watch recorded a night, and nothing is overwritten.
- **Native app, live HealthKit sync, Health Connect and wearables** stay deliberately out of the PWA — see
  [§5](#5-later-a-native-wrapper-still-no-mac) for the path, which still needs no Mac.

### Phase 6 — AI coach, weekly review, sleep ✅
- **AI coach** (*More → AI coach*): chat with Claude about **your own data**. It uses read-only tools to look up
  your profile and targets, weight trend, training summary, exercise history, programme, nutrition, food log, sleep,
  goals and measurements, weekly review, foods, saved meals and meal plan. It never changes anything.
  Every point in a reply is labelled **Fact**, **Calculation**, **Suggestion** or **General**. Replies stream in,
  the conversation is kept on the device, and offline use is handled cleanly (everything else keeps working).
- **AI meal ideas** (Nutrition → *Ideas for the rest of today*, or Plan → *Meal ideas*): ideas for a meal, for the
  rest of today (based on what's left of your calories and protein), or for batch cooking. They are built from foods
  you actually use, and nutrition comes from your food database wherever an ingredient matches. Nothing is saved until
  you tap **Save meal** or **Plan**, which also feeds the shopping list.
- **Connecting Claude** (*More → AI settings*): either paste your own Anthropic API key (stored only on this phone,
  never synced or backed up), or use the optional server proxy (see §4) so no key lives on the phone.
  Models: Claude Opus 5 (default) or Claude Sonnet 5.
- **Weekly review** (*More → Weekly review*, and a card on Today on Sundays and Mondays):
  - The week's numbers: workouts vs target, sets and volume vs last week, PBs, average calories and protein,
    average weight vs last week, water and sleep.
  - A **habit score** that shows its parts.
  - **What went well** (facts) and up to three **focus points** (suggestions — they never change your targets).
  - Share it, or tap *Discuss with coach*.
- **Sleep** (*Progress → Sleep*, and a Sleep card on Today):
  - Log bedtime, wake time and quality in two taps.
  - A chart of hours per night against an 8 h line, plus average, quality, short nights and bedtime consistency.
  - **Sleep & training**: once there's enough data, it compares your lifting after 7 h+ nights with shorter ones.
  - Sleep is included in the CSV export and in sync.

### Phase 5 — Meal prep ✅
- **Weekly meal planner:** Monday → Sunday × breakfast / lunch / dinner / snack. Each day shows its calories and protein
  against target, and the week shows averages. Plan any food or saved meal. You can copy an item to other days,
  move it between meals, "Copy last week", or clear the week.
- **Meal prep:** pick a recipe (set "Makes N servings") and spread the portions over the next days in one tap.
- **"Mark as eaten"** logs a planned meal. Today shows what's planned and has an **Eaten** button.
- **Shopping list:** built automatically from the week's plan. It adds up every ingredient
  (e.g. "600 g (≈ 4 × 1 breast)") and groups items by aisle: meat & fish, dairy & eggs, fruit, vegetables,
  carbohydrates, snacks, other. There are big checkboxes, your own extra items, rebuilding keeps your ticks,
  and you can **share** the list as text.
- **AI meal ideas** arrived in Phase 6 (see above).

### Phase 4 — Nutrition ✅
- **Food database:** about 100 common foods built in (per-100 g values, works offline), plus **your own foods**
  (per 100 g or per serving, with a serving size). You can star favourites.
- **Online lookup + barcode scanner:** search **Open Food Facts** (free, no key) or scan a barcode with the camera.
  Anything you pick is saved to your foods, so it works offline next time.
- **Fast logging:** the Add food sheet shows recent foods (with the amount you usually have), favourites, saved meals
  and search. Pick a food, choose servings or grams, and see a live calorie/protein/carbs/fat preview.
  Quick-add calories is still there.
- **Saved meals & recipes:** save any logged meal in one tap, or build a recipe from ingredients.
  "Makes N servings" is for batch cooking, and you log with one tap.
- **Meal history:** a day switcher with a date picker, tap an entry to change its amount or meal, "Log again",
  "Same as yesterday" per meal, and fibre in the day's totals. Averages and trends are in Progress → Nutrition.

### Phase 3 — Progress ✅
- **Progress tab sections:** Overview · Body · Photos · Training · Nutrition · Goals.
- **Goals:** body weight and weekly sessions (from your profile), plus your own **strength goals** (e.g. Bench Press
  80 → 100 kg, heaviest weight or estimated 1RM) and **measurement goals** (e.g. waist 84 → 80 cm). Each shows
  start → current → target, % progress, when it was achieved, and a **projected finish date** at your recent rate.
  The projection is labelled as a calculation. The top goals also appear on Today.
- **Body:** weight chart (drag to read values), 7-/30-day averages, rate, weekly **and monthly** averages.
  **Body measurements** cover chest, waist, arms, thighs, shoulders, hips and neck in cm or inches, with how-to-measure
  hints, change per site and a chart per site.
- **Progress photos (private):** front/side/back check-ins on a timeline. Photos are resized on the phone and stored
  inside the app, never in your camera roll. A **compare** view offers a drag slider or side by side, showing the
  weeks between and the weight change. If you're signed in, photos upload to a **private per-user cloud folder**,
  and other devices download them on demand. You can export photos via the share sheet.
- **Training analytics:** workouts, sets, volume, PBs, average session length, sessions per week against your target,
  weekly volume, working sets per muscle, and estimated-1RM trends for your main lifts. Ranges are 4 weeks to 1 year.
- **Nutrition analytics:** average calories and protein against target, days logged, days on target, daily calorie
  and protein charts, macro split and average water. Ranges are 7, 30 or 90 days.
- **Overview:** the last 4 weeks against the previous 4, goals, and quick logging for weight, measurements and photos.
- Charts follow one visual system: thin marks, clean axes, a colour palette checked for colour-blind safety, tap
  or drag to read values, and a **Show data** table under the main charts.

### Phase 2 — Gym ✅
- **Programmes & routines:** ready-made Push/Pull/Legs, Upper/Lower and Full Body templates, or build your own.
  Per exercise: sets, rep range, warm-up sets, rest time, supersets, reorder. Edits save instantly.
- **Exercise library:** 60 built-in exercises plus your own custom ones; search and filter by muscle.
- **Today tells you what's next:** routines rotate (Push → Pull → Legs → Push…). The card shows each exercise's
  last session and **today's suggested weight × reps**, with a one-tap **Start workout**.
- **Gym Mode:** full-screen and built for one thumb. It has a big weight/reps stepper, a large *Complete set* button,
  and a set table (Prev · weight · reps · ✓). Warm-up and drop sets, optional RPE and exercise notes are there too.
  Supersets alternate exercises automatically. The screen stays awake where iOS allows it.
- **Rest timer:** starts automatically after each set and adjusts ±15 s. It survives the app being closed or reloaded,
  and beeps (plus vibrates on Android) when rest is over.
- **Progressive overload (double progression):** hit the top of your rep range on every set (RPE ≤ 9) and the app
  suggests the next weight step. If you're inside the range, it suggests adding reps. Below the range twice in a row,
  it suggests a ~10% deload. These are **only suggestions** that pre-fill today's sets; your routine never changes by itself.
- **PB detection:** heaviest weight, most reps at a weight, estimated 1RM (Epley) and session volume, each shown
  with your previous best. You get a live 🏆 toast during the workout, a PB list on the summary, and recent PBs on Today.
- **Works offline:** a workout started with no signal is saved on every tap and syncs when you're back online.
- **History:** a workout summary after Finish, history by week, and per-exercise history with an e1RM chart.
  There's also a consistency card (sessions this week vs target, week streak) and a CSV export (one row per set).

### Phase 1 — Foundation ✅
- Installable PWA (manifest, icons, iOS splash screens, standalone mode, service worker)
- Offline-first: app shell is cached, all data lives on the phone (IndexedDB)
- Onboarding: profile, goal, current + target weight, calorie + protein targets (Mifflin–St Jeor estimate, fully editable)
- **Today** dashboard: calories & protein remaining, body-weight trend, water, coach insight
- Nutrition quick-add, water tracking, weigh-ins with 7-day average & weekly rate, progress chart
- Optional cloud accounts + sync (Supabase) with an offline outbox, retries and last-write-wins conflict handling
- Data ownership: JSON backup/restore, CSV export, erase
- Dark mode (default), light mode, kg/lb, cm/ft-in

All seven phases are in place. What's left is the optional native wrapper (§5).

---

## 1. Put it on your iPhone (≈10 minutes, no Mac)

The service worker (offline support + install) needs **HTTPS**, so the easiest path is a free host
that builds straight from this GitHub repo.

### Option A — Vercel (recommended, works with private repos)

1. Go to <https://vercel.com>, sign in with GitHub.
2. **Add New → Project → Import** this repository. Vercel detects Vite automatically — just press **Deploy**.
3. You get a URL like `https://gym-xyz.vercel.app`. Every push to `main` redeploys; every branch gets a preview URL.

(Netlify works the same way — `public/_redirects` is already included.)

### Option B — GitHub Pages

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** → add `ENABLE_PAGES` = `true`.
3. Push to `main`. The app appears at `https://<username>.github.io/<repo>/`.
   (Private repos need a paid GitHub plan for Pages.)

### Install it

1. Open the URL in **Safari** on your iPhone.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch **Fitness OS** from the Home Screen — it opens full-screen, and keeps working in airplane mode.

When a new version is deployed, the app shows **"A new version is ready — Update"**; it never reloads on its own mid-entry.

## 2. Develop on Windows

Install [Node.js 22 LTS](https://nodejs.org), then:

```bash
npm install
npm run dev        # http://localhost:5173 (also printed: a Network URL for your phone)
npm test           # unit tests (calculations, sync engine, backup)
npm run typecheck
npm run build      # production build in dist/
npm run preview    # serve the production build (service worker active)
```

To try the dev server on your iPhone, open the **Network** URL Vite prints (same Wi-Fi).
Offline mode and installation need HTTPS, so test those on the deployed URL (a Vercel preview URL
per branch is perfect for this).

## 3. Optional: cloud accounts & sync (Supabase)

Without this the app runs in **on-device mode** — everything works, data just lives on the phone
(export backups from *More → Data & backup*). To add accounts, backup and multi-device sync:

1. Create a free project at <https://supabase.com>.
2. **SQL Editor** → paste and run each file in [`supabase/migrations/`](supabase/migrations/) in order
   (`0001_init.sql` … `0008_prices_and_reset.sql`). When a new phase adds a migration, run just the new file.
   `0003` also creates the private `progress-photos` storage bucket (owner-only access).
3. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
4. Add them as environment variables where you build:
   - Vercel: **Project → Settings → Environment Variables** → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, then redeploy.
   - GitHub Pages: repository **secrets** with the same names.
   - Local: copy `.env.example` to `.env.local` and fill it in.
5. (Optional) **Authentication → Providers → Email**: turn off "Confirm email" if you want to sign in immediately after sign-up.

Then *More → Account & sync → Create account*. Anything already on the phone is uploaded on first sign-in.

**Sharing with friends:** send them the app link; each person installs it and creates their own account in the
same app (so you all use one Supabase project). Then one of you creates a group under *More → Friends* and taps
**Invite**. Your data stays private — friends only see the summaries each person chooses to share.
The anon key is safe to ship in the app: Row Level Security restricts every row to its owner.

## 4. Optional: AI coach without a key on the phone (Supabase Edge Function)

The simplest setup is *More → AI settings → My API key*: the key is stored only on that phone and requests go
straight to Anthropic. Set a monthly spend limit in the Anthropic Console.

If you'd rather keep the key on a server, deploy the included proxy
([`supabase/functions/claude`](supabase/functions/claude/index.ts)). It only answers signed-in users whose email
is on your allow-list, and only forwards `/v1/messages` for the two supported models:

```bash
npm i -g supabase            # or use npx supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_EMAILS=you@example.com
supabase functions deploy claude
```

Then pick *More → AI settings → My server* in the app (it appears once cloud sync is configured and you're signed in).

## 5. Later: a native wrapper (still no Mac)

The PWA covers everything in the spec except things iOS only allows native apps to do: **live** HealthKit
read/write, Apple Watch apps, widgets, and reliable background notifications. When the PWA has been stable for a
while, the plan is:

1. **Wrap, don't rewrite.** Add [Capacitor](https://capacitorjs.com) around the existing `dist/` build
   (`npm i @capacitor/core @capacitor/ios && npx cap add ios`). The React app, IndexedDB data layer, sync engine and
   Supabase backend stay as they are; native features become small plugins behind the same interfaces
   (e.g. a `HealthSource` that the Apple Health import already defines the shape of: weigh-ins + nights).
2. **Build in the cloud.** Xcode only runs on macOS, but hosted macOS builders do it for you from GitHub:
   GitHub Actions `macos-latest` runners, Codemagic or Ionic Appflow. They sign the app and upload it to
   TestFlight, so installing it on the iPhone happens through the TestFlight app. Code signing needs an
   **Apple Developer Program** membership (paid, yearly) — that's the only new requirement.
3. **HealthKit.** A HealthKit plugin replaces the file import with live reads of body mass and sleep analysis
   (and could write workouts back). The app must request each permission, and Apple reviews HealthKit usage.
4. **Android later.** The same wrapper with `@capacitor/android` and a Health Connect plugin covers Android.
5. **Wearables** (Garmin, Oura, Whoop …) use OAuth web APIs. Those belong in Supabase Edge Functions (tokens stay
   server-side) that write into the same tables, so the app needs no changes to show the data.

Until then, the PWA keeps working offline, installs from Safari, and imports Apple Health data by file.

---

## Architecture

```
 UI (React)  ──reads──▶  IndexedDB (Dexie)  ◀──live queries re-render the UI
     │                        ▲
     └─ writes via db/repo ───┤ record + outbox entry in ONE transaction
                              │
                        Sync engine (sync/)  ── push outbox, pull changes ──▶  Supabase (Postgres + RLS)
```

- **Local-first.** The phone's database is the source of truth for the UI. Nothing waits for the network.
- **Outbox.** Every write queues its record id. Repeated edits coalesce; failed uploads retry with exponential backoff.
- **No duplicates.** Ids are client-generated UUIDs and uploads are upserts, so resending is harmless.
- **Conflicts.** Last write wins on `updatedAt`, enforced both on the device and by a Postgres trigger.
- **Deletes** are soft (`deletedAt`) so they sync too.
- **When sync runs.** iOS has no Background Sync API, so: on launch, when the network returns, when the app comes to
  the foreground, ~1.5 s after a change, and every minute while open.
- **App shell** is precached by a Workbox service worker (`vite-plugin-pwa`), so the app opens with no signal.

### Project layout

```
src/
  db/          types.ts (data model), db.ts (Dexie schema), repo.ts (all writes), hooks.ts (live queries)
  sync/        engine.ts (push/pull), manager.ts (auth + triggers + status), remote.ts (Supabase), mapping.ts
  db/seed/     built-in exercise library + programme templates (seeded on-device, stable ids)
  lib/         dates, units, calc/ (nutrition, weight, training maths), insights (coach rules), backup (export/restore)
  pwa/         service-worker update prompt, install prompt, platform helpers
  components/  shared UI: BottomNav, Sheet, NumberField, LineChart, Toast, …
  features/    onboarding/, today/, workout/ (hub, routines, library, history, gym/ = Gym Mode), nutrition/,
               progress/ (overview, body, goals, analytics, photos/, sleep/), review/ (weekly review),
               coach/ (AI coach chat, read-only data tools, meal ideas, AI settings), friends/ (groups, leaderboard), more/
  components/charts/  BarChart, MeterList, StackBar, ChartTable (+ components/LineChart)
  styles/      tokens.css (colours, dark/light), base, layout, components
supabase/migrations/   cloud schema
supabase/functions/claude/   optional Claude proxy (keeps the API key server-side)
scripts/generate-icons.mjs   regenerates icons + iOS splash screens from public/icons/icon.svg
```

### iPhone / PWA notes

| Feature | iPhone behaviour |
| --- | --- |
| Install | Safari → Share → Add to Home Screen (no prompt API on iOS; the app shows instructions) |
| Offline | ✅ service worker + IndexedDB |
| Safe areas / Dynamic Island | ✅ `viewport-fit=cover` + `env(safe-area-inset-*)` everywhere |
| Storage | Home Screen apps are exempt from Safari's 7-day storage cap; we also request persistent storage |
| Background Sync API | ❌ not on iOS → syncs on open / reconnect / foreground instead |
| Vibration | ❌ not on iOS → silently skipped (works on Android) |
| Push notifications | iOS 16.4+ for installed apps only — planned for later |
| Apple Health | No web API — import the Health export file (weight + sleep); live sync needs the native wrapper (§5) |
| Camera (barcode) | ✅ `getUserMedia`; the camera permission is asked the first time you scan |
| Screen wake lock | Used in Gym Mode where supported (recent iOS Home Screen apps); otherwise the screen may dim |
| Rest-timer alert | Beep plays when the app is open; iOS can't run timers in the background, so if you lock the phone the timer is correct when you return but won't alert |

To regenerate icons after editing `public/icons/icon.svg`:
`npm i -D playwright && npx playwright install chromium && npm run icons`.

## Roadmap

1. **Foundation** — PWA, profile, targets, Today, offline + sync ✅
2. **Gym** — exercise library, routines, Gym Mode, set logging (RPE, warm-up/drop/super sets), rest timer, PBs, progressive overload ✅
3. **Progress** — measurements, goals, progress photos, analytics ✅
4. **Nutrition** — food database, custom foods, saved meals, meal history ✅
5. **Meal prep** — weekly planner, shopping lists, AI meal generator ✅
6. **AI coach** — questions over your own data, AI meal generator, weekly review, sleep ✅
7. **Integrations** — barcode scanner ✅, Apple Health import ✅; native wrapper, live HealthKit / Health Connect and wearables once the PWA is stable (§5)
