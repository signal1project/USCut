# USCut — Agent Handoff

**Updated:** 2026-08-04 (Mick / ClaudeClaw) — v1.0 stabilization + roadmap items 1-3b
**Status:** ✅ 287/297 tests pass (10 skipped, Electron-ABI) · tsc clean · eslint clean
(0 errors/warnings — was previously broken, see decisions log) · vite build clean ·
pushed to `main`
**Read this FIRST before touching the repo.**

---

## v1.0 — What changed (2026-07-11/12 production sprint)

Full CapCut-parity editor + production social pipeline, built in one sprint
(commits `8bb7442` → HEAD). Highlights per subsystem:

**Export engine v2** (`electron/main/aicuts/exportGraph.ts` — pure, unit-tested):
- ONE ffmpeg `filter_complex` graph replaces trim-and-concat. Timeline gaps render
  black+silence (caption/music timing exact); audio-track clips mix in via `adelay`
  on the compressed timeline; per-clip volume/speed/fades honored.
- Transitions: xfade + acrossfade (fade/wipes/slide/circle). Transitions compress the
  timeline — `compressTime()` maps caption/music/overlay times.
- Aspect presets 16:9 / 9:16 / 1:1 / 4:5 × 720p/1080p/4K. Styled ASS caption burn-in.
- Overlay tracks (video tracks 2+ and images) composite via `overlay=`; chroma key,
  eq color adjustments, zoompan motion presets all in-graph.
- **ffmpeg binary = ffmpeg-static 6.1.1** via `electron/util/ffmpegBinary.ts`
  (the old @ffmpeg-installer binary is a 2018 build without xfade — fallback only).

**Editor**: real undo/redo (drag-coalesced history in editorStore), caption styling
(size/color/bold/position/box), image imports + overlay placement controls, color
presets + sliders, green screen, motion presets, real waveforms
(`aicuts:audio-peaks`, cached in userData/waveforms), Whisper one-click captions
(`aicuts:transcribe-video`, needs OpenAI key), SAPI Voice Studio (`aicuts:tts`,
keyless), volume applied in preview, per-clip speed in preview.

**Media pipeline**: `aicut-media://` protocol (webSecurity-safe, Range-supporting);
preview proxies for HEVC/odd containers (userData/preview-proxies); projects
autosave to userData/projects with Save/Save As/Recent Projects.

**Production social pipeline:**
- **Share button** (editor toolbar) → silent export to userData/shares → post to
  signed-in webview platforms and/or API accounts, optional scheduling.
- **Webview posting** (`adapters/webviewBridge.ts`): CDP `DOM.setFileInputFiles`
  attaches the exported video (pierces iframes/shadow DOM), fill scripts type
  captions, auto-submit on X/LinkedIn; other platforms attach+fill and leave the
  window for one review click. Caption always copied to clipboard.
- **API video upload** (`adapters/videoUpload.ts`): X v2 chunked upload, FB page
  video multipart, IG Reels resumable upload, Pinterest media→pin. Threads API
  needs a public URL (error message points at the webview path). Local-path media
  routes to byte upload; http(s) URLs keep server-side fetch.
- **Reliability**: close-to-tray (default ON) + launch-at-login (Settings → App
  Behavior); scheduled posts REHYDRATE at boot and missed ones catch up
  (`mas/scheduledFiring.ts` — also fixed rows never leaving QUEUED = double-post
  bug); desktop Notifications on scheduled-post outcomes; schedule requests
  without a content asset auto-persist one.

**AI providers**: ChatGPT sign-in (Codex device-code OAuth, gpt-5.5, no key) +
OpenRouter OAuth + Ollama + API keys (Claude/OpenAI/Groq). Full management on
`/mas/settings` (also: multi-company brand profiles, App Behavior, integrations).

**Dale-side actions still required for the API posting half:**
1. Register developer apps: Meta (FB+IG+Threads — app review for publish perms
   takes weeks; start first), X (media.write scope), Pinterest, TikTok, YouTube.
2. Paste client IDs into ConnectAccounts (Advanced/API) per platform.
3. Until then: webview posting works with plain sign-ins TODAY.

---

## v1.1 — Stabilization + roadmap items 1-3b (2026-08-04 session)

**Stabilization:** `npm run lint` had been silently fatal-erroring on every run —
`.eslintrc.cjs` referenced `react-hooks/exhaustive-deps` via inline disable comments
in 4 files, but `eslint-plugin-react-hooks` was never installed/registered, so `--fix`
never got to run across the repo. Fixed the config, which surfaced (and let `--fix`
mechanically clean up) unused imports and Prettier formatting drift across ~150 files
— no semantic changes, verified via tsc/tests/build before and after. Also found and
fixed a real bug while investigating a rules-of-hooks false positive:
`WebView/index.tsx`'s unmount cleanup closed over a stale `webViewId` (always -1),
so webview browser views were likely never actually destroyed on unmount — fixed with
a ref.

**Shipped:**
- Publish Reel shortcut (roadmap item 1) — see routing note in Feature Map below.
- Local whisper.cpp fallback for auto-clip (roadmap item 2) — see Open Items below for
  honest functional status (correctly engineered, blocked on machine-level prerequisites).
- ElevenLabs upgrade for Voice Studio (roadmap item 3b) — optional, SAPI stays default.

**Explicitly NOT built — Remove Background (roadmap item 3a):** the obvious local
package is AGPLv3-licensed, incompatible with closed-source commercial distribution.
Flagged to Dale rather than shipped; needs a direction decision (see Open Items).

---

## What USCut Is

AI-powered desktop video editor + social media automation suite (CapCut competitor with a
Buffer/Opus-Clip feature set bolted on), leaning real-estate. Fully local-first: FFmpeg,
SQLite, and Windows SAPI TTS run on the user's machine; AI provider keys are optional and
most features degrade gracefully without them.

- **Stack:** Electron 33 + React 18 + Vite + TypeScript + Zustand + Tailwind + TypeORM
  (better-sqlite3) + fluent-ffmpeg + express (embedded APIs) + vitest.
- **Repo:** `C:\home\dalebrown138\projects\Social-Engine-USCut` (Windows-native shared
  folder — NOT WSL `~/`). GitHub: `signal1project/USCut`, branch `main`.
- **Local branch quirk:** work happens on `push-v4-2`; push with
  `git push origin push-v4-2:main` (fast-forward).
- **MCP wrapper repo (Hermes team's):** `Social-Engine-AICut-Hermes` (sibling folder, not yet renamed).
- **Naming rule (Dale, 2026-07-07):** "USCut" = this repo ONLY. The archived
  `_archive\BLK-INK-Scraper` is reference-only; never build there.

## How to Run / Verify

```powershell
cd C:\home\dalebrown138\projects\Social-Engine-USCut
npm run dev          # dev app (use `dev`, NOT dev:mac — has chcp 65001 fix)
npm test             # vitest — 235 pass, 10 skip (Electron-ABI, see below)
npx tsc --noEmit     # typecheck
npx vite build       # renderer + main + preload bundles
npm run build:ext    # Chrome extension → dist-ext/
npm run package:win  # → release\USCut-win32-x64\USCut.exe
```

**Gotchas**
- After fresh `npm install`, run `npm run rebuild` (better-sqlite3 → Electron ABI).
- DB tests (`masSchema`, `listingStore`) auto-skip under plain Node — that ABI mismatch is
  expected, not a failure. Follow the `describe.skipIf(!nativeLoads)` pattern for new
  DB-touching tests.
- Windows paths only; repo must stay on the Windows filesystem.

## Runtime Topology (three embedded servers, all loopback)

| Server | Port | Auth | Purpose |
|---|---|---|---|
| MAS API | ephemeral | rotating bearer token | Everything under `/api/*` — publish, content, analytics, engagement, research, listings, clips, insights. Renderer gets url+token via IPC `mas:api-info`. **Discovery file (with token): `%APPDATA%\aicuts\api-port.json`** — local agents use this. |
| Listing capture server | **7474** (`AICUT_CAPTURE_PORT`) | none (loopback+CORS) | Chrome-extension listing capture ONLY (`/api/listings/*` minus ad/video generation). Port inherited from retired BLK INK Scraper. |
| Agent bridge | **4255** (`AICUT_BRIDGE_PORT`) | bearer | Video-editor ops for MCP agents (`/api/aicut/*`). Discovery: `%APPDATA%\aicuts\aicut-bridge.json`. |

Generated artifacts: `%APPDATA%\aicuts\{listing-reels, clips, bio-page}\`. DB:
`%APPDATA%\aicuts\database.sqlite` (TypeORM `synchronize:true` — new entities in
`electron/db/index.ts` entities array auto-create tables).

## Feature Map (v0.6) — module → API → UI

| Feature | Backend module | API | UI |
|---|---|---|---|
| Video editor (timeline/speed/fades/export) | `electron/main/aicuts/` | bridge :4255 | `/editor` |
| AI Auto-Edit + Auto-Captions | `aicuts/autoEdit.ts` | IPC | editor AI panel |
| **Auto-Clip** (long video → captioned vertical shorts) | `electron/main/clips/` | `POST /api/clips/auto` | editor AI panel card |
| Publish / schedule (8 platforms, webview + OAuth) | `publishEngine/`, `adapters/`, `scheduling/` | `POST /api/publish` | `/mas/publish`, `/mas/scheduler` |
| AI content (posts, **A/B variants**, **carousels**, images) | `content/` | `POST /api/content/{generate,carousel,image}` | `/mas/content` |
| **Brand Kit** (voice rules injected into every brief) | `settings/settings.ts` | IPC `mas:settings:{get,set}-brand-kit` | `/mas/brand` |
| Idea Scraper + trending research | `research/` | `GET /api/research/{scrape,trending}` | `/mas/research` |
| **Listing Scraper** (Chrome ext + paste-URL capture) | `listings/` | `POST /api/listings/capture`, `/capture-url` | `/mas/listings` + `chrome-extension/` |
| **Generate Listing Ad** (compliance-gated copy) | `listings/adService.ts` | `POST /api/listings/:id/generate-ad` | Listings page button |
| **Listing Video Generator** (photos → narrated reel) | `listings/videoService.ts` | `POST /api/listings/:id/generate-video` | "Create Reel" button |
| Fair Housing / RESPA guard | `listings/complianceGuard.ts` | runs at capture + on all listing-ad output | shield badges |
| **Best-time-to-post / calendar / evergreen recycle** | `insights/` | `GET /api/insights/{best-times,calendar}`, `POST /recycle` | Scheduler page |
| **Competitor benchmarks** (manual snapshots) | `insights/router.ts` + settings | `/api/insights/competitors` CRUD | Analytics page |
| **Bio page generator** (static HTML export) | `insights/bioPage.ts` | `POST /api/insights/bio-page` | Brand page |
| Inbox (comments + AI reply drafts) | `engagement/` | `/api/engagement/*` | `/mas/engagement` |
| Analytics snapshots | `analytics/` | `/api/analytics/*` | `/mas/analytics` |
| Bulk CSV scheduling | client-side | (uses `/api/publish`) | Scheduler page |
| Omobono workflow packages | `workflow/`, `capcut/` | `/api/workflow/*` | `/mas/pipeline`, `/mas/omobono` |

**Composition root:** `electron/main/mas/runtime.ts` — every service is wired there and
mounted as a `FeatureRoute`. Add new features as sibling modules
(`service + router + index + __tests__`) and register in runtime.

## What Needs Keys vs. What Works Keyless

- **Keyless:** editor, listing capture (ext + URL), compliance guard, template listing ads,
  listing reels **with narration** (Windows SAPI), auto-clip with pasted SRT/VTT
  (heuristic picking), best-times, calendar, recycle, CSV import, bio page, competitors,
  brand kit storage, Idea Scraper.
- **AI provider (Settings/onboarding — OpenRouter OAuth or Ollama local both keyless-ish):**
  AI post generation, A/B variants, carousels, AI-quality listing ads, AI clip picking,
  AI auto-edit/captions.
- **OpenAI key specifically:** Whisper transcription (auto-clip without a transcript),
  image generation.
- **Per-platform OAuth apps (Dale registers at dev portals):** API publishing, analytics
  capture, engagement ingest. Webview login (`adapters/webviewBridge.ts`) works without.

## Legal / Non-Negotiables

- **Fair Housing Act + RESPA guard** (`listings/complianceGuard.ts`) runs on captured
  listing descriptions and ALL generated listing-ad copy. Blocked copy is returned but
  flagged `complianceOk:false` — UI marks it "blocked — do not publish". NEVER remove or
  bypass this gate; extend patterns instead (tests in `__tests__/complianceGuard.test.ts`).
- Ad/video generation endpoints live ONLY on the authed MAS API — never expose them on the
  open :7474 capture server (unauthenticated AI-credit burn).

## Docs Index

- `docs/USER-GUIDE.md` — end-user onboarding, step by step (keep updated with features).
- `OMOBONO-HANDOFF.md` — agent-integration surface for the Hermes team.
- `HANDOFF.md` — older session notes (historical).
- Mick's session memory: `C:\ClaudeClaw\.memory\{active-tasks,decisions-log}.md`.

## Open Items / Roadmap

1. ~~"Publish Reel" shortcut~~ — **DONE** (2026-08-04): generated reel → Scheduler
   prefilled via router state (ListingScraperPage → SchedulerPage).
2. ~~Whisper local fallback~~ — **DONE, not yet functional** (2026-08-04):
   transcribeViaLocalWhisper() wired as a 3rd tier (provided > OpenAI key >
   local whisper.cpp), nodejs-whisper as an optionalDependency so it can't
   break `npm install`. Needs a C++ build toolchain (CMake + MSVC) to actually
   compile whisper-cli — same prerequisite as Mymo's virtual-camera phase —
   plus nodejs-whisper's own Windows model-auto-downloader currently has a bug
   (invokes a .cmd it doesn't ship). Degrades gracefully with a clear error
   either way; paste-transcript and OpenAI-key paths are unaffected.
3. Remove Background — **BLOCKED, needs Dale's call**: the obvious local
   package (`@imgly/background-removal-node`) is AGPLv3 — incompatible with
   closed-source commercial distribution, do not use it or anything else
   AGPL/GPL here. A cloud API (remove.bg etc.) would mean per-frame charges
   across a whole video at 30fps — real cost-surprise risk without an
   explicit pricing decision. Needs Dale to pick a direction before building.
   ~~Voice Studio (ElevenLabs)~~ — **DONE** (2026-08-04): optional upgrade
   over the existing keyless SAPI default, key stored/managed on the Settings
   page.
4. Platform OAuth app registration — Dale, per dev portal (Meta/X/LinkedIn/etc.).
   This is the only remaining blocker on the production social-posting pipeline.
5. NSIS installer needs admin/Developer Mode (winCodeSign symlink issue); `package:win`
   works today. Confirmed 2026-08-04: Developer Mode has never been enabled on
   this machine — needs Dale to flip it (Settings → Privacy & security → For
   developers) before packaging can proceed.
6. DM inbox — vendor-gated on messaging scopes for the platform OAuth apps.

## How to Work With Dale

Direct, systems-thinker, automation-first. Verify in the running app before claiming done
(launch `npm run dev`, hit the API with the token from `api-port.json`, probe outputs with
ffprobe). Commit messages: what shipped + what was verified. Push = `push-v4-2:main`.
Flag anything legally sensitive (compliance, platform ToS) before building it.
