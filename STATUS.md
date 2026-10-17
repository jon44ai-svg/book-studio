# Book Studio status

Last updated: 2026-10-18

## Current state

Book Studio is deployed as a PWA with Neon/Postgres persistence in production
and SQLite fallback for local development. The latest production change is
queued on Vercel from commit `85ed928`.

## Implemented

- Installable PWA shell with safe offline caching.
- Book library, book creation, editing, deletion, and status changes.
- Novella pipeline:
  - planner, bible, outline, parallel chapter writers, auditor, and editor
  - pause, reset, retry, budget reservations, retries, and fallback models
  - persisted tasks, usage, chapters, issues, and run logs
- Neon/Postgres production persistence with SQLite local fallback.
- SQLite-to-Neon migration command:
  - `pnpm run migrate:sqlite`
- Per-user encrypted Groq credentials when the database and encryption key
  are configured.
- Structured generation hardening and malformed JSON recovery.
- Accessible generation progress UI.
- Markdown, text, EPUB, and PDF exports with validation and stable filenames.
- Model, budget, chapter-count, concurrency, and retry policy validation.
- Redacted structured errors with correlation IDs.
- Offline draft queue primitives.
- Updated Book Studio logo and removed starter/TanStack social callouts.
- Regression checks and production build pass.
- `pnpm audit --audit-level high` reports no known vulnerabilities.

## Recently fixed

- Production SQLite initialization on Vercel caused `/var/task/data` errors;
  production now uses Neon when its connection variable is configured.
- PostgreSQL lowercased unquoted aliases such as `updatedAt`, causing
  `Invalid time value`; camelCase aliases are now quoted.
- Neon numeric `COUNT(*)` values could be treated as truthy strings, causing
  task creation to be skipped.

## Not implemented yet

- Drizzle ORM schema and migrations.
- Complete account/profile experience and user-owned book authorization.
- Runware-generated book covers.
- Automatic model-pricing discovery and refresh from a provider API.
- Detailed issue views and issue-to-chapter navigation.
- Total page-count calculation and display.
- Dedicated mobile-friendly e-reader mode.
- User-selectable color palettes.
- Inline book and brief editing.
- Fish Audio text-to-speech integration.
- Bring-your-own Fish Audio key and custom speaker management.
- Feature-request UI and persistent product feedback records.
- Persistent error/eureka worklog UI.

## Verification notes

- Focused novella and safeguard checks: passing.
- Production build: passing.
- Full repository TypeScript check still reports unrelated pre-existing
  demo/content-collections errors.
- Production URLs may be protected by Vercel Deployment Protection during
  automated verification.

## Next recommended order

1. Migrate persistence access to Drizzle and formalize database migrations.
2. Add account ownership and authorization boundaries.
3. Add inline editing, issue details, page counts, and reader mode.
4. Add provider integrations: Runware pricing/covers and Fish Audio TTS.
5. Add feature-request and worklog persistence plus UI.
