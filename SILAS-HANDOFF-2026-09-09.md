# USCut — Handoff for Silas (2026-09-09)

**From:** Mick / ClaudeClaw
**Supersedes:** `SILAS-HANDOFF.md` (2026-09-07) and `MICK-HANDOFF-2026-09-09.md` where they conflict — both are still useful background, this is the current state.
**Repo:** `C:\home\dalebrown138\projects\Social-Engine-USCut` · GitHub `signal1project/USCut`
**Branch:** local `push-v4-2`, **even with `origin/main` at `487e5c0`**, working tree clean.
**Push:** `git push origin push-v4-2:main` (fast-forward). Dale authorises pushes per-task; the last several sessions have been push-as-you-go once each change verifies clean.

**Health (last full run 2026-09-09, after the licensing-service round):**
`npx tsc --noEmit` clean · `npm run lint:eslint` clean · `npx vitest run` = **553 passed / 12 skipped** · `node scripts/test-database-upgrades.mjs` = 4/4 under the Electron ABI · `npx vite build` clean · `services/licensing` `npm test` green (offline lifecycle + 9 `node --test` cases incl. a full HTTP round trip). **Packaged-app smoke green on the rebuild after this round** (`npm run rebuild && npx electron-builder --win nsis --publish never` → afterPack gate passed → `node scripts/smoke-stabilization.mjs "release/0.1.0/win-unpacked/USCut.exe"` all PASS). Re-run that pair after any dependency or native-path change.

### Update — 2026-09-09 late (Silas's rate-limited work, picked up by Mick)

- **`f5d9f26`** (Silas) — project-backup ZIP hardening (`System.IO.Compression` instead of `Compress-Archive`/`Expand-Archive`, entry-name whitelist + traversal/count/size limits, atomic pending-zip rename, non-ENOENT copy errors abort); Stripe webhook signature verification via the SDK; production `npm audit` findings 39 → 11 (0 critical) via dep updates; removed unused `build` dep. `docs/RELEASE-HARDENING-2026-09-09.md`.
- **`43788bf`** (Mick) — mechanical Prettier sweep of ~30 files of pre-existing formatting drift (the §4C housekeeping item; line-wrapping only).
- **`953e853`** (Mick, finishing Silas's uncommitted work) — the licensing **service is no longer a bare scaffold**: `webhook.mjs` (SDK raw-body verify), `billing.mjs` (queries *live* Stripe subscription state, price-restricted, never invents paid time), `store.mjs` (persistent JSON, event-id idempotency, atomic writes, restart-safe, single-writer), `auth.mjs` (`/activate` requires a verified-email JWKS JWT — email-only activation removed), `server.mjs` (async `createLicensingServer` factory). Desktop verifier (`commont/entitlement.ts`) got stricter token/claim validation (+7 negative cases). Tests: `test-{webhook,billing,store,auth,http}.mjs`.
- Still **NOT done** on subscriptions (all Dale-blocked, unchanged): Stripe account + test keys, deployed private signing key, a real identity provider (`AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_JWKS_URL`), a persistent volume, the customer checkout + billing-portal UI, and app-side **feature gating** (still not wired — status shown, nothing locked).
- **`22c44d9`** (Mick) — removed unused `image-size` + `echarts` direct deps (clears 1 high + 1 moderate); `docs/SECURITY-AUDIT-2026-09-09.md` assesses every remaining finding. `npm audit --omit=dev` now **9 (6 high / 3 moderate / 0 critical)**. Runtime items to track: `sharp`/libvips (upstream), `electron` 33 → current (scoped major upgrade — ABI rebuild + full re-test). Build-time only (not shipped): `extract-zip`, `esbuild`, `vite`. Not reachable: `react-router` (no SSR, static nav).
- **Packaged rebuild after this round: green.** `npm run rebuild && electron-builder --win nsis --publish never` (exit 0, afterPack gate passed) → `release/0.1.0/win-unpacked/USCut.exe` passed the full stabilization smoke.
- **`487e5c0`** (Mick) — this handoff update + the `docs/COMMERCIAL-RELEASE.md` gate table (subscription row now "implemented, blocked on Dale"; new Dependency-security row). origin/main == `487e5c0`.

Read `AGENT-HANDOFF.md` (repo root) for architecture/topology. Read `docs/COMMERCIAL-RELEASE.md` for the gate table.

---

## 1. The goal (Dale, unchanged)

USCut = a full AI-powered video-production product, **subscription-based (Stripe)**, ready to **sell**. It is **not** finished software yet. Passing tests ≠ done. The remaining work is enumerated in §4 and is **all blocked on Dale** — see §5 for what you can and cannot pick up.

---

## 2. What changed since the 2026-09-07 handoff

### Committed & pushed by Silas (Codex), `12c139d` → `c6fe940`
Auto-Edit atomic validation; OS-encrypted AI secrets + legacy migration; chunked cloud transcription; durable Auto-Clip jobs; production-readiness checks + live music dir; `signal1project/USCut` publish-target fix; **native Production Studio** (`/mas/studio`); **durable background export jobs**; autosave-ordering fix + project `.json.bak` recovery.

### Committed & pushed by Mick this session, `f6956eb` → `ae64f88`

| Commit | What |
|---|---|
| `f6956eb` | **DB upgrade safety** (finished Silas's uncommitted batch, verified). Runtime `synchronize:true`/`migrationsRun:true` retired. Startup now runs explicit **transactional** migrations behind a verified WAL-inclusive online SQLite backup (`electron/db/upgrade.ts`), written to `database-backups/` **only when migrations are pending**. New `ProductionBaseline1788955200000` additive-adoption migration reconciles a `synchronize`-built profile (9 tables / 13 columns the old migration files never created) with **zero data loss**; frozen schema in `1788955200-schema.json`. Post-migration integrity + entity/column parity check; on failure it rolls back and keeps the backup, and a DB-open failure now shows a real error dialog. Tests: `electron/db/__e2e__/upgrade.integration.ts` + `scripts/test-database-upgrades.mjs`. Also: local Whisper now **execs the bundled `whisper-cli` + `ggml-base.en` model directly** (spawn, AbortSignal, timeout) — no first-use C++ compile, no model download, no shelljs `.cmd`. `afterPack` hook (`scripts/verify-packaged-runtime.cjs`) **fails a Windows build** whose bundled FFmpeg/Whisper won't start or whose model is missing. `USCUT_PROFILE_DIR` isolated diagnostic profile (`electron/main/profile.ts`), applied before any store/DB opens. |
| `f543787` | **Studio frame-grounded planning + single-scene AI revision.** When the active provider implements `analyzeFrames` (Claude/OpenAI), the storyboard job samples frames from each clip (`electron/main/aicuts/studioVision.ts`, ≤3/video via the existing `frameSampler`, 1 downscaled frame/image) and injects a one-sentence factual description per asset into the planning prompt (surfaced in the UI as "What the AI saw"). No vision provider → unchanged filename/brief planning. New `revise` job kind + per-scene "Revise with AI". Pure helpers in `commont/studio.ts` (`buildStoryboardPrompt`, `parseStoryboardScenes`, `buildRevisionPrompt`, `applySceneRevision`). |
| `f6f797f` | **Studio music beds.** `electron/main/aicuts/studioMusic.ts`: lists a configured music folder (shared with the listing-reel pipeline — root + one level of subfolders); `prepareMusicBed` renders the bed with real ffmpeg to the finished timeline length (loop a short track / trim a long one, 2s tail fade, **10-min render cap**, AbortSignal). `studioDraftSchema` gains an optional `music {src,name,volume}`; `assembleStudioProject` adds a low-volume `Music` audio track. IPC `aicuts:studio-music-list`. |
| `6687a3f` | **Versioned production documents.** `commont/studioDoc.ts` (pure reducers) + `electron/main/aicuts/studioDocs.ts` (atomic per-file storage under `userData/studio-productions/`). Replaces the localStorage-only draft. Every "Save as production" appends an **immutable** version with an optional note; "Restore" re-adopts a past version as a *new* version; history capped at 40. IPC `aicuts:studio-doc-{save,list,get,restore,delete}`. Working draft still autosaves to localStorage between saves. |
| `18112e4` | **Editor Share render → durable export JobManager.** `aicuts:export-job-start` gained `share: true` (no save dialog, renders to `userData/shares/`, label "Share render"). `ShareDialog` starts that job and polls it to completion before attaching the file to platform windows — survives navigation/exit, cancellable from the Export jobs panel. Removed the synchronous `aicuts:export-for-share` handler. |
| `37ef0c9` | **Portable project backup/restore.** Home page: "Back up" per project + "Restore from backup". `exportProjectArchive` copies every referenced media file into a staging `media/`, rewrites clip/library `src` to archive-relative, drops now-stale `previewSrc`, and zips with PowerShell `Compress-Archive` (Windows-only product). Missing sources are **reported, not fatal**, and keep their original path. `importProjectArchive` expands into a fresh project id + its own `restored-media/<id>/` folder, self-contained, never clobbers the original. Pure path logic in `commont/projectArchive.ts` (unit-tested); Windows e2e drives the real zip round trip. |
| `ca93260` | **Startup GC.** `electron/main/aicuts/startupCleanup.ts` runs on app-ready: removes this app's transient temp staging dirs (`uscut-archive-`/`uscut-restore-`/`uscut-studio-img-`/`aicut-frames-`/… under `os.tmpdir`) older than 2h, and partial `.uscut-render-<uuid>.<ext>` files from `userData` + `userData/shares`. **Only** this app's own transient names — never finished output or project media. |
| `c425e50` | **Subscription entitlement.** `commont/entitlement.ts`: ed25519-signed compact tokens (`base64url(claims).base64url(sig)`). The app bundles **only the public key** (`electron/main/licensing/entitlement.ts`) and verifies **offline**. `resolveLicenseStatus`: active → grace (14-day offline window past the paid period) → expired → invalid; `isPremiumUnlocked`. Token + last-verified timestamp persisted in `Settings` (signed, not a secret). IPC `license:status` / `license:activate` / `license:deactivate`. Settings page gets a **Subscription card** (`src/views/mas/SubscriptionCard.tsx`). **Feature gating is NOT wired** — status is shown, nothing is locked — pending Dale's tier decisions. `services/licensing/` is a **scaffold** (token sign path mirroring the verifier, `/webhook` + `/activate` + `/health`, in-memory store, `.env.example`, `test-lifecycle.mjs`) — **not connected to Stripe, not deployed.** |
| `2169484` | **Commercial-evidence docs**: `docs/FEATURE-MATRIX.md`, `docs/LICENSE-INVENTORY.md`, `docs/ONBOARDING.md`. |
| `fee1e2d` | **Packaged installer built + verified** (see §3) + `docs/RELEASE-CANDIDATE-AUDIT.md`. |
| `ae64f88` | Trimmed ~20 unused whisper.cpp binaries from the package via electron-builder `files` negations (rebuilt, afterPack + packaged smoke still green; ~3 MB — the 147 MB model is the bulk). Also committed the handoff docs. |

---

## 3. Packaging status

`npm run rebuild` then `npx electron-builder --win nsis --publish never` **succeeds** (exit 0):
- native `better-sqlite3` rebuilt for Electron 33.4.11 ABI
- **`afterPack` gate passes**: "Packaged FFmpeg and Whisper start successfully; base.en model is present"
- output: `release/0.1.0/USCut-0.1.0.exe` (~510 MB) + `win-unpacked/`
- the build **auto-signed every exe via `signtool.exe`** — a certificate exists in the machine's store. **Nobody has confirmed whether it's a real publisher cert or a self-signed/dev cert.** This matters for release.
- `electron-builder.json` `publish` target is `signal1project/USCut` (correct — the stale `signal1-blkink/Master_AI_Social` target is gone). **Always pass `--publish never`** and confirm no `GH_TOKEN`/`EP_*` env vars.

`release/0.1.0/win-unpacked/USCut.exe` passes the **full** stabilization smoke: packaged DB init + migrations, bundled local Whisper transcription, Studio build with music + narration, versioned production docs, `.uscut.zip` backup/restore, subscription status, startup cleanup, project recovery.

**Not done:** a true pristine-VM install / in-place-update / uninstall pass (`docs/RELEASE-CANDIDATE-AUDIT.md` §3). `deleteAppDataOnUninstall: false` is set, so uninstall keeps `%APPDATA%\aicuts\`.

---

## 4. What's LEFT — all of it is blocked on Dale

| # | Gate | What Dale must supply / decide |
|---|---|---|
| 1 | **FFmpeg licence** | `ffmpeg-static` bundles a **GPL-3.0** FFmpeg build. For a closed-source commercial product: switch to a modern **LGPL** FFmpeg build (then re-verify the xfade / acrossfade / adelay / ASS burn-in / zoompan e2e suite — `videoService.*.e2e.test.ts`), **or** keep GPL FFmpeg with a counsel-blessed compliant-aggregation path (source offer + notices). `docs/LICENSE-INVENTORY.md` row 1. **Do not silently swap the ffmpeg build** — this repo has a history of xfade regressions when it changes (see the 2026-08-19 memory entry). |
| 2 | **Stripe** | Create the account; set price/currency; deploy `services/licensing` with the **private** signing key at `C:\home\dalebrown138\projects\_secrets\uscut-license.private.pem` (that path is **outside the repo** — never commit it; the matching public key is in `electron/main/licensing/entitlement.ts`); replace the in-memory store with a DB; register the webhook. |
| 3 | **Seller identity + support email** | Into the installer metadata, the app "About", and the `docs/ONBOARDING.md` "Support" placeholder. |
| 4 | **Code-signing certificate** | Confirm the cert used by the build is a real publisher cert; if not, obtain one and configure signed installer + signed auto-updates. |
| 5 | **Generated footage (text-to-video)** | The one AI-production feature not built. Choose a provider (Runway / Pika / Veo / …) + set a spend cap, **or** explicitly cut it from launch scope. |
| 6 | **Proprietary EULA** | Replace the MIT `LICENSE` and `package.json` `"license": "MIT"`; bundle a `NOTICES/` set (whisper.cpp MIT, Apache NOTICEs for kokoro-js / transformers / onnxruntime, the two **OFL-1.1** font licences — Montserrat + Playfair Display are fine to bundle, they just need their licence text — Chromium `LICENSES`, and the FFmpeg GPL text + written offer if kept). |
| 7 | **Clean-VM QA** | Fresh install → in-place update → uninstall (data preserved) → reinstall, on a machine that has never run USCut. `docs/RELEASE-CANDIDATE-AUDIT.md` §3. |
| 8 | **Live verification** | One real Zillow `/homedetails/` capture (clear the press-and-hold anti-bot, Capture, Create Reel → Post Now). One real Facebook / Instagram / TikTok post through a webview window (only X + LinkedIn auto-submit; the rest are attach + fill + human clicks Post — intended). Instagram multi-account detection ("Connect Accounts → Instagram → Detect My Accounts", check `%APPDATA%\aicuts\logs\`). |

### Deliberately deferred (not blocked, just low value)
- **One-click caption durable job.** `aicuts:transcribe-video` (editor "Auto-Captions") stays synchronous: it's a bounded ~15-30 s op the user waits for, its result is applied to *live* editor state (adds caption clips), and re-running is cheaper than a persisted "apply job X" flow. Auto-Clip — the long, file-producing one — is already a durable job. Only revisit if Dale asks.
- **Installer bloat.** Still ~510 MB. 147 MB is the Whisper model (unavoidable if it ships offline-capable). `nodejs-whisper`'s unpacked tree is ~187 MB — the whisper.cpp source + build artifacts could be trimmed further with more `files` negations, but the win is small.

---

## 5. Guidance for Silas

**You cannot finish this alone.** Every §4 item needs Dale. Do **not**:
- swap the ffmpeg build on your own judgement (§4.1),
- wire hard feature-gates on subscription state (that's a product decision — Dale hasn't set tiers),
- commit anything under `projects/_secrets/`, or generate/commit a new licence keypair (the public key in the app must stay matched to the private key Dale deploys),
- attempt real social posting or a real Zillow capture without Dale present,
- create accounts, buy certs, or connect Stripe.

**You can, if Dale explicitly asks:**
- implement the Stripe wiring inside `services/licensing/server.mjs` once Dale provides test-mode keys (the `parseStripeEvent` placeholder + the datastore are the two seams),
- build the LGPL ffmpeg swap **after Dale picks that path**, gated on the full ffmpeg e2e suite staying green,
- wire subscription feature-gating **after Dale defines the tiers**,
- draft the `NOTICES/` bundle (mechanical — the licence texts are public),
- do the one-click-caption durable job if Dale wants it,
- further trim the installer.

**Every change:** `npx tsc --noEmit` + `npx vitest run` (expect 549+/561) + `npx vite build` + `node scripts/smoke-stabilization.mjs` before claiming done. For anything touching packaging or native/runtime paths, also `npm run rebuild && npx electron-builder --win nsis --publish never` and `node scripts/smoke-stabilization.mjs "release/0.1.0/win-unpacked/USCut.exe"`. Commit at the end of every clean build (split by feature, honest verification tier in the message); push only on Dale's per-task go-ahead.

---

## 6. Gotchas (still true)

1. **No safe computer-use path to USCut's window** — it's launched via a `.vbs`, not Start-Menu-registered, so a generic "Electron" grant resolves to Tandem Browser (a different sphere) or another `electron.exe`. Verify live state via `%APPDATA%\aicuts\` files, `database.sqlite` read-only via `node:sqlite`, or ask Dale.
2. **Verify via the real browser `fetch()` path, not curl** — the renderer always sends `Authorization`, forcing a CORS preflight; a curl check bypasses an entire class of bug. Drive the real dev app (or the packaged smoke).
3. **DB tests auto-skip under plain Node** (`describe.skipIf(!nativeLoads)`) — 12 skipped is the normal state.
4. **Zombie Electron processes** — every main-process save triggers vite-plugin-electron's relaunch; if a "should just work" feature doesn't, check `Get-Process electron` / `Get-NetTCPConnection -LocalPort 7474` and verify each PID is *this repo's* `node_modules\electron\dist\electron.exe` before killing.
5. **Sphere boundaries** — this machine also runs OpenClaw (`:18789`, `:3587`), HermesClaw (WSL `:9119`), 9router (WSL `:20128`). Never bind a port without checking first; never touch another sphere's files/processes.
6. **Internal identifiers stay `aicut`/`aicuts`** (IPC prefix, `aicut-media://`, `%APPDATA%\aicuts\`, discovery files, npm package name, `[AICut]` log tags). Closed decision. "USCut" is display-name only.
7. **`commont/` is the (misspelled) shared dir** — not `common/`. Pure, cross-process code lives there (`studio.ts`, `studioDoc.ts`, `projectArchive.ts`, `entitlement.ts`, `exportGraph.ts`, …).
