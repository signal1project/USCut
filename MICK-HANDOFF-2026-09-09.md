# USCut handoff for Mick

From Silas / Codex — September 9, 2026

## Owner direction and release status

Dale wants USCut completed as full AI-powered video production software and made ready to sell. His commercial decision is **USCut, subscription based**. Do not narrow completion to a supplied-media editor or call this finished merely because current tests pass. It is **not yet ready to sell as finished software**.

Subscription price/currency, payment account, seller identity/support email, and signing credentials have not been supplied. No subscription backend or entitlement enforcement is implemented. No production checkout, public release, paid footage generation, or real social post was performed in this work. Dale authorized continued implementation and pushes. New instructions from Dale govern any subsequent work.

## Repository state verified for this handoff

- Repository: `C:\home\dalebrown138\projects\Social-Engine-USCut`
- Local branch: `push-v4-2`
- Remote: `https://github.com/signal1project/USCut.git`
- Local HEAD and remote `main`: `c6fe9406bea8ccb03d8a028621fda6b37d78e121`
- Push command used: `git push origin push-v4-2:main`
- At inspection, only untracked file was your original `SILAS-HANDOFF.md`; preserved unchanged. This new handoff is also copied to root as `MICK-HANDOFF-2026-09-09.md`, without committing it.
- No unfinished source edits remain. No tests, build, installer, or background agent is currently being intentionally left running.
- Read `AGENT-HANDOFF.md`, your original `SILAS-HANDOFF.md`, and `docs/COMMERCIAL-RELEASE.md` for the broader architecture and release gates.

## What Silas completed and pushed

### Stabilization before Studio

- Auto-Edit responses are validated; excluded clips are actually removed. Applying changes is an atomic undo step and refuses stale project/timeline results.
- AI secrets moved into OS-encrypted storage with verified legacy migration; generic settings IPC cannot read secret branches.
- Cloud transcription uses bounded sequential audio chunks, timestamp offsets, progress/cancellation hooks, timeouts, and cleanup. Local Whisper remains a separate fallback with portability work outstanding.
- Durable Auto-Clip jobs expose progress, cancellation, explicit result import, deduplication, and restart interruption detection.
- Local production readiness checks and configurable listing music directory are wired. Empty music directories do not fabricate music.
- Electron-builder publish target corrected to `signal1project/USCut`.

### `af26850` — native Production Studio

Added `/mas/studio` and sidebar navigation. It accepts a brief and supplied video/images, generates a storyboard through the existing AI provider resolver, or allows manual scenes. Scenes have media selection, source offset, duration, headline, and narration script.

Building validates actual video duration and file availability, optionally generates Windows SAPI narration, and assembles a native USCut project with separate visual, caption/headline, and narration tracks. Images extend for narration; video scenes fail clearly when footage is too short. Narrated scenes mute source audio. Opening results saves the current editor and creates a fresh copy so subsequent editing is not overwritten by reopening a job.

Jobs/results persist under the app profile; drafts currently persist in renderer localStorage. Applying AI output explicitly replaces the draft. Planning uses filenames and timing, **not visual analysis**. No generated footage, spending cap, targeted AI scene revision, or versioned production document exists yet.

Files: `commont/studio.ts`, `electron/main/aicuts/studio.ts`, `src/views/mas/StudioPage.tsx`, `docs/PRODUCTION-STUDIO.md`.

### `155742e` — background export jobs

Toolbar exports now enqueue jobs with a native save dialog and expose a persistent Export jobs panel. Jobs capture the submitted timeline, serialize rendering, report progress, support cancellation, and reveal completed files. They survive navigation; app exit marks unfinished work interrupted on next startup rather than rerunning it automatically.

FFmpeg supports AbortSignal cancellation and caption temporary-file cleanup. Job exports render to a unique sibling temporary file and replace the destination only after success. Failures/cancellation preserve an existing destination. Destination reservations prevent simultaneous jobs targeting the same path, and direct source overwrites are rejected. Transient Windows rename locks are retried.

The legacy synchronous export/share IPC still exists; ShareDialog still uses its existing export-for-share path. Export jobs do not yet include crash-time orphan temporary-file cleanup or automatic resumption. Review those limits as part of release hardening.

Files: `electron/main/aicuts/exportJobs.ts`, `ffmpegOps.ts`, `src/views/editor/ExportJobsPanel.tsx`, `Toolbar.tsx`.

### `c6fe940` — autosave protection and project recovery

Fixed stale renderer save acknowledgments marking newer edits saved, changing another project's save status, and older failures overriding a newer successful save. Failed IPC keeps edits dirty.

Project writes are serialized per file, use unique temporary files and Windows rename retries, and preserve one previous valid `.json.bak`. Loading falls back to that backup when the primary is corrupt and displays a recovery notice. A corrupt primary never replaces a good backup. These are **metadata backups**, not copies of source media or complete portable archives. Project IDs are validated rather than sanitized into colliding filenames.

Corrected the home screen's inaccurate claim that connected AI runs entirely locally.

Files: `electron/main/aicuts/projectStorage.ts`, `projects.ts`, `src/lib/projectPersistence.ts`, `docs/PROJECT-RECOVERY.md`.

## Verification evidence and limits

- Last full suite after export-job changes: **507 passed, 12 existing skips**, 60 passed test files / 3 skipped. Do not claim the skipped database tests passed.
- After project recovery changes: **7 additional targeted tests passed** (3 storage, 4 renderer persistence). A new full-suite total was not run after these final changes.
- TypeScript, changed-source ESLint, and Vite production builds passed after the final recovery changes. Existing large renderer chunk warning remains.
- `node scripts/smoke-stabilization.mjs` passed against the actual built Electron app using an isolated profile, fake credentials, supplied media, and real FFmpeg/SAPI. It does not touch Dale's live accounts or publish anything.
- Latest smoke artifacts: `test-results/stabilization-rTcnV5/`, including `export-jobs.png`, `studio.png`, `readiness.png`, and other screenshots.
- Smoke verifies secure migration/protected IPC, authenticated local API, Auto-Edit undo/redo/autosave, Auto-Clip job recovery/cancellation/import, readiness/music configuration, native narrated Studio project creation, queued export through toolbar UI, saved export job results, portrait/landscape MP4 stream dimensions/audio/duration, and real project-load recovery after deliberately corrupting an isolated project file.
- Unit tests actually kill real FFmpeg during an export and verify the prior destination remains intact.
- No fresh installer or clean-machine install/upgrade test was completed during this latest work. No real paid AI storyboard call or generated-footage provider call was used to verify Studio.

Commands: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`, then `node scripts/smoke-stabilization.mjs`. Use targeted ESLint on changed source; the root `test/` directory is outside the current ESLint TypeScript project configuration. After dependency installation, use the repo's Electron native-module rebuild workflow if SQLite ABI requires it.

## Next work — release blockers

1. **Database upgrade safety:** `electron/db/index.ts` currently has BOTH `synchronize: true` and `migrationsRun: true`. Audit entity/migration parity, back up the actual database safely, and test migration from existing profiles before turning synchronization off. Do not simply disable it and assume all later schema changes have migrations.
2. **Installer/runtime verification:** package without publication (`--publish never`), verify bundled FFmpeg, SQLite, Whisper/model paths, Kokoro/native dependencies and extension assets; test fresh install, upgrade, uninstall preserving customer data, and launch without developer tooling. Preserve Dale's live installation/profile.
3. **Subscription system:** hosted checkout, verified payment webhooks, customer activation, signed/verified entitlements, renewal/revocation, offline behavior, billing management and test-mode lifecycle coverage. No provider/payment account has been chosen or connected by this work. Never embed private billing/signing secrets in the desktop application.
4. **Complete AI production:** generated footage/provider integration and spending controls, grounded media analysis, scene-level revisions, Studio music controls, durable caption/share jobs and production-document versioning. The supplied-media path is progress, not a substitute for Dale's requested full product.
5. **Data and operational readiness:** portable project/media backup and restore, diagnostics, crash recovery and failed job cleanup; signed releases/update validation.
6. **Commercial evidence:** supported-feature matrix, onboarding/support materials, dependency/font/model/media license inventory and appropriate review, controlled live Zillow/social-delivery verification, final release-candidate audit. Keep implementation completion separate from live verification and customer launch.

## Decisions and boundaries to preserve

- Internal `aicut`/`aicuts` identifiers stay; USCut is display branding.
- Background removal was explicitly dropped; do not reintroduce it.
- Zillow-only listing scraper. Preserve listing compliance guards.
- Facebook/Instagram/TikTok assisted publishing prepares media/caption; the user clicks final Post. Scheduling supports API-connected accounts. Do not silently promise unattended posting for webview-only accounts.
- Use `createProviderResolver(settings)` for AI features rather than hardcoding SDK/provider selection.
- Keep modern FFmpeg resolution through `createRequire`/the existing resolver; bare CommonJS require fails in bundled ESM.
- Original handoff remains authoritative context where not superseded by actual newer code and Dale's instructions.

## Codex usage context

At this handoff check, Codex reports 13% of the five-hour allowance used (87% remaining), reset September 9 at 6:19 PM EDT; weekly 35% used. Three banked reset credits remain unused. The earlier goal panel was `usageLimited`; this does not mean work is complete or code was lost. Usage can change and should be checked live. The immediate handoff request is not authorization to redeem a credit.
