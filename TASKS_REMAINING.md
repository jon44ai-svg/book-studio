# Book Studio: remaining tasks

State at this commit: the library, manuscript editor, SQLite store, Groq client,
and export module exist. The novella pipeline does NOT exist yet, so the
novella dashboard does not compile (`src/lib/novella.server.ts` is missing).

## 1. Pipeline runner: `src/lib/novella.server.ts` (blocking)

Not written. Required exports (the UI depends on these names):

- Types: `Brief`, `Settings`, `RunStatus`, `TaskStatus`, `TaskView`, `ChapterView`,
  `IssueView`, `NovellaView`
- `defaultSettings()`, `validateSettings(s)`
- `getNovella(bookId)`, `saveBrief(bookId, brief, settings)`
- `startRun(bookId)`, `pauseRun(bookId)`, `resetRun(bookId)`
- `resumeInterruptedRuns()` (run once on module load)

Requirements:

- Tables: projects, tasks, usage (one row per attempt), chapters, issues, logs.
- DAG: planner -> bible + outline -> writer:1..N (parallel) -> auditor ->
  editor:n (only if `reviseRounds >= 1` and issues exist).
- Budget: drafting envelope (planner/bible/outline/writer) and reserve envelope
  (auditor/editor). Reserve `(estIn * pIn + maxOut * pOut) / 1e6 * (1 + margin)`
  before dispatch. Reconcile from returned usage. Failures without usage are
  charged as uncertain. Refuse dispatch when it would exceed either envelope or
  the total; set `budget_exhausted` and keep completed work.
- Zero or missing price = not configured; block the run.
- Retries: retryable errors only (429, 5xx, network, invalid JSON). Honor
  `Retry-After`. Re-reserve before each retry. Optional fallback model, once.
- Concurrency: global `maxConcurrent`, per-model `perModelConcurrency`.
- Persist each task result before unblocking dependents.
- Pause stops dispatch; in-flight requests finish and are reconciled.
- Startup: `running` projects become `paused`; their `running` tasks return to
  `queued` and their reservation becomes uncertain spend.

## 2. Self-check: `src/lib/novella.check.ts` (not written)

- Local fake OpenAI-compatible server; set `GROQ_BASE_URL` before importing.
- Use a temp DB under `~/.cache`, never `data/books.sqlite`.
- Assert: full run completes; spend <= total; reserve returns to 0; a second
  `startRun` after completion makes no new requests; a tiny budget ends in
  `budget_exhausted` without exceeding it.
- Find a working runner first (`vite-node`, `tsx`, or vitest).

## 3. UI reconciliation: `src/lib/novella.fns.ts`, `src/routes/novella.$bookId.tsx`

Written against guessed field names. Fix to the contract:

- `brief.mustHave` (UI uses `plotPoints`)
- `budget.spentUsd`, `reservedUsd`, `uncertainUsd`, `draftingRemainingUsd`,
  `reserveRemainingUsd`, `totalRemainingUsd` (UI uses `spent`, `reserved`, ...)
- `tasks[].chapterNumber`, `costUsd`, `reservedUsd` (UI uses `chapter`, `cost`)
- `chapters[].wordCount`, `revised`
- Once `novella.server.ts` exists, run `pnpm exec tsc --noEmit` and fix all
  errors in these files.

## 4. Export verification: `src/lib/novella-export.ts`

- Written; `selfCheck()` has not been confirmed to run.
- Check EPUB with a zip listing (mimetype first, STORE method).
- Check PDF xref offsets and `%%EOF`.
- Known limit: PDF is ASCII-only (typographic quotes and dashes are substituted).

## 5. Prototype cleanup

- `public/groq-studio.html` is the old simulated pipeline page. It is no longer
  linked. Delete it once the real pipeline is in place.
- `specs.md` and `Groq Book Studio (2).html` are reference specs; keep as
  reference.

## 6. Verification

- `pnpm exec tsc --noEmit` clean for all novella files.
- `pnpm dev` serves `/`, `/books/$bookId`, `/novella/$bookId` without errors.
- Self-check passes.
- Real smoke test: one planner call with a real `GROQ_API_KEY` (not run; needs
  the key on the target machine).

## 7. Environment notes

- Termux: `os.cpus()` is empty, so `content-collections.ts` has a shim. Remove
  it if running on a normal Linux/macOS host.
- Required env: `GROQ_API_KEY` for the pipeline. `BOOK_STUDIO_DB_PATH` is
  optional (defaults to `data/books.sqlite`).
- Run: `pnpm install`, then `pnpm dev`.
