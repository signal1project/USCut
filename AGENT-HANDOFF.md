# USCut — Agent Handoff

## Reel-spec template shipped + a real ffmpeg-selection bug fixed — 2026-08-19

**Read this first if you're touching video export, ffmpeg, or the listing-reel
pipeline.**

A new opt-in listing-reel template landed this session (inherited uncommitted from
2026-08-18, no handoff note from that session — committed as-is once verified clean):
`reelTemplate: 'reel-spec'` alongside the existing legacy Ken-Burns pipeline. Classifies
listing photos into a 6-block hook/kitchen/living/primary+bath/money-shot/CTA structure
(`electron/main/listings/video/roomBuckets.ts`), picks standard-vs-luxury styling by price
(`priceTier.ts`), narrates via Kokoro-82M (local/offline neural TTS, `kokoroNarration.ts`,
falls back to Windows SAPI then none), and mixes in music beds from
`public/assets/music/{standard,luxury}/` (**Dale is populating these now** — empty
resolves to silent-except-narration gracefully, not an error). New `photoCaptions` field
on captured listings (Zillow extension now pairs each photo with its room-label caption)
feeds the room classifier. UI: Create Reel now has a small options panel (template/price
tier/narration engine/hook text) — `src/views/mas/ListingScraperPage.tsx`.

**Two real, previously-undiscovered bugs found and fixed while live-verifying this**
(both are bundling issues in `vite.config.ts` / the main-process Rollup build, not
anything Dale needs to change behaviorally):

1. **The app could not boot at all** once kokoro-js became a dependency — instant crash
   on `npm run dev`/packaged launch: `Could not dynamically require
   "../bin/napi-v3/win32/x64/onnxruntime_binding.node"`. kokoro-js pulls in
   onnxruntime-node (native binding, runtime-computed require path) as a *transitive*
   dependency, so it was never in `vite.config.ts`'s Rollup `external` list (built from
   `package.json`'s own `dependencies` keys) and Rollup's commonjs plugin tried to bundle
   it, which can't work for a dynamic native require. Fixed by explicitly externalizing
   `onnxruntime-node`/`onnxruntime-common`/`@huggingface/transformers`. If you add another
   dependency that itself depends on a native `.node` binding, check whether it's a
   *direct* `package.json` dependency (auto-externalized) or transitive (needs adding to
   that explicit list by hand) — this bug class will recur otherwise.
2. **ffmpeg has been silently running on the ancient 2018 `@ffmpeg-installer` binary (no
   xfade support) in every real run of the app — dev and packaged — likely since
   ffmpeg-static was introduced, not something new this session.** `resolveFfmpegPath()`
   (`electron/util/ffmpegBinary.ts`) called a bare `require('ffmpeg-static')`. The
   main-process bundle loads as an ES module, where bare `require` has no global to
   resolve against — it threw `ReferenceError: require is not defined` on every single
   call, silently caught, always falling through to the old binary. **Vitest never caught
   this because tests run under plain Node, where a bare `require` happens to exist** — so
   every prior "live-verified via real ffmpeg" claim anywhere in this repo's history was
   only ever proven under vitest's Node process, never the actual Electron one. It
   surfaced now because reel-spec's cross-dissolve/whip-cut transitions were the first
   thing to exercise a transition-heavy `filter_complex` through the *real running app*
   instead of only vitest — failed with `ffmpeg exited with code 1: Error initializing
   complex filters. Invalid argument` (the old binary rejecting xfade). Fixed with
   `createRequire(import.meta.url)` — a real CJS require bound to the file's own URL,
   correct under both ESM and CJS. **The main editor's own transition-based export
   (Toolbar → Export, with any clip transition) runs through the exact same
   `exportProject()` function** reel-spec uses — proven working live post-fix via
   reel-spec's luxury-tier cross-dissolve reel, so it's covered too, not a separate
   unverified surface. Worth a normal spot-check next time you export something with a
   transition for real, just to see it with your own eyes.

**Verified for real**: after both fixes, booted the actual dev app fresh (confirmed via a
temporary diagnostic that `resolveFfmpegPath()` returned the broken path pre-fix and the
correct one post-fix, then removed the diagnostic), POSTed a mock listing with
`photoCaptions` to the real `:7474` capture server, called the real authed MAS API with
`reelTemplate:'reel-spec', priceTier:'luxury', narrationEngine:'kokoro'`, ffprobed the
result: genuine 1080×1920 h264 + AAC, 15.6s. Also separately live-smoke-tested Kokoro
standalone before touching any of this (first real model download, 89MB/~12s, real 5.8s
WAV out — not part of the committed test suite, a one-off manual proof). Full suite
420/432 pass throughout (12 skipped = expected Electron-ABI), tsc clean, vite build clean.
Cleaned up the test listing + generated reel from the live `%APPDATA%\aicuts` DB/dir;
verified all electron.exe PIDs were this repo's own `node_modules\electron\dist\
electron.exe` before stopping them. 3 commits on `push-v4-2`, **pushed to main** (Dale's
go-ahead): `150dcea` (reel-spec feature) → `6ca9669` (the two bundling fixes) →
`af7b817` (UI wiring).

**Still open**: music beds are empty pending Dale's in-progress track sourcing; the new
Create Reel options panel hasn't been click-tested by a human yet (no safe computer-use
path to USCut's window — see Sphere Gotcha note below, unchanged); Dale is about to run
the app himself and debug live — next session should expect to pick up whatever he finds.

## Codex readiness audit — 2026-08-13/14

Independent review found and fixed four tomorrow-critical gaps that were not
covered by the earlier mock-capture/FFmpeg verification:

1. Zillow's `gdpClientCache` is often JSON encoded as a string. The extension
   treated that shape as unusable and fell through to brittle DOM scraping.
   `zillow.ts` now parses nested cache strings and searches the bounded
   hydration subtree for the property record. Three extension regression tests
   cover object cache, string cache, and unrelated data; extension tests are now
   included in the main Vitest configuration.
2. Narration used FFmpeg `-shortest` without padding, so a normal five-photo
   reel could be cut off when the spoken track ended before the visual
   timeline. Narration is now silence-padded so the complete reel and CTA card
   survive. The real FFmpeg E2E test asserts the exact seven-second visual
   duration used by its fixture.
3. Zillow CDN/error bodies and malformed images could abort or even hang the
   render. Downloads now use browser-like image headers (including Zillow
   referer), reject non-image responses, validate raster signatures before
   FFmpeg, and skip unreadable photos with a title-card fallback. A real FFmpeg
   regression test covers the malformed-photo case.
4. The prior handoff's Scheduler/webview claim was incorrect: Scheduler routes
   through API-connected accounts, while the instant FB/IG/TikTok webview calls
   did not receive the generated reel path. Listing reels now expose **Post
   Now**, which opens Publish prefilled with the local video and caption;
   Publish passes that local path to FB/IG/TikTok CDP attachment. **Schedule**
   remains available for API-connected accounts only, and webview-only accounts
   are excluded from the unattended Scheduler picker with an honest message.

Verification after fixes: `npx tsc --noEmit` clean; `npm run build:ext` clean;
full build/test run clean at **315 passed / 10 expected Electron-ABI skipped
(325 total)**; real FFmpeg tests include vertical video, title-card fallback,
narration duration, and corrupt-photo handling. Fresh `npm run dev` smoke test
booted the renderer plus capture server `:7474` and agent bridge `:4255`; capture
health returned HTTP 200. Current Facebook, Instagram, and TikTok Studio entry
URLs were checked and redirect to the expected login surfaces when signed out.

Still requires Dale's normal browser/account sessions: Zillow presented its
current Press-and-Hold anti-bot challenge during automated detail-page review,
so the final real capture must be done in Dale's Chrome session. Load/reload
`dist-ext/`, open one Zillow `/homedetails/` page, complete any human challenge,
click **Capture Listing**, then in USCut use **Create Reel → Post Now**. Select
Facebook, Instagram, or TikTok, verify the reel is attached and caption filled,
then click the platform's final Post button manually. Do not use **Schedule**
for browser-session accounts; unattended scheduling requires API-connected
developer accounts.

**Updated:** 2026-08-14 (Codex audit after Mick / ClaudeClaw handoff)
**Status:** ✅ 315/325 tests pass (10 skipped, Electron-ABI)
· tsc clean · extension build clean · dev app boots clean, all 3 embedded servers up · NOT yet committed (previous
session's uncommitted files below are still uncommitted too — Dale hasn't asked for a commit)
**Read this FIRST before touching the repo.**

## Earlier Mick verification record (2026-08-13; corrected by audit above)

Dale's ask: "scrape Zillow listings and turn the pictures into videos formatted for
Facebook, Instagram, and TikTok" — this was already built (inherited from BLK INK
Scraper's Chrome extension + a purpose-built `ListingVideoService`), just never
proven working end-to-end in the running app. Tonight it was, for real, no mocks:

1. Booted the actual dev app (`npm run dev`) — MAS API, capture server `:7474`, and
   agent bridge `:4255` all came up clean, zero errors besides benign devtools console
   noise.
2. POSTed a mock Zillow-shaped payload to the **real running** `:7474/api/listings/capture`
   endpoint (exactly what `chrome-extension/content/zillow.ts` sends) — captured
   correctly, compliance guard ran, listing appeared via `GET /api/listings`.
3. Called the **real** `POST /api/listings/:id/generate-video` against the authed MAS
   API — `ListingVideoService` ran actual `ffmpeg` (Ken Burns pans/zooms + address/price
   banner + CTA end card + Windows SAPI narration), produced a real file.
4. `ffprobe`-verified the output: **1080×1920 h264 video + AAC audio track, 7s** — the
   correct vertical format for FB/IG Reels, IG/FB Stories, and TikTok natively (no extra
   aspect-ratio work needed; this is different from the editor's own 16:9/9:16/1:1/4:5
   export presets, which are a separate pipeline).
5. Confirmed the old `Schedule` button handed the reel path + caption to Scheduler,
   but this did not prove browser-session posting; Scheduler is the API-account path.
   The audit above added the missing `Post Now` → Publish → webview attachment path.
6. Read (did not drive) `webviewBridge.ts`'s posting flow for facebook/instagram/tiktok:
   all three open a real logged-in `BrowserWindow`, CDP-attach the video file
   (`attachMediaViaCdp`, pierces iframes/shadow DOM), fill the caption, copy caption to
   clipboard as a safety net, then — **deliberately** — leave the window open for Dale to
   click Post himself (`autoSubmit: false` for all three; composer markup shifts too
   often to trust an auto-click). This is not a gap, it's the intended design.
7. Added a real (non-mocked) regression test:
   `electron/main/listings/__tests__/videoService.e2e.test.ts` — generates two real JPEGs
   via ffmpeg, runs them through the actual `ListingVideoService`, ffprobes the output.
   Catches ffmpeg-path/filter-graph regressions that the existing helper-only unit tests
   (`videoHelpers.test.ts`) can't.
8. Cleaned up: deleted the test listing + test reel file from the live
   `%APPDATA%\aicuts` DB/dir afterward so Dale's real data stays clean. Stopped the dev
   `electron.exe` (pid confirmed via `Get-Process` to be this repo's
   `node_modules\electron\dist\electron.exe`, not another sphere's, before killing).

**What is NOT verified and needs Dale's hands, not mine** — posting requires his own
logged-in social sessions and his own final click (by design, and also because I won't
post to real accounts on his behalf without him present):

- Whether Zillow's current DOM/`__NEXT_DATA__` shape still matches `zillow.ts`'s parser
  — Zillow changes this periodically; the paste-URL fallback (`capture-url`, schema.org/
  OpenGraph) is a safety net if the extension parser goes stale.
- Live posting through the FB/IG/TikTok webview windows against his real logged-in
  sessions — the attach/fill DOM selectors could be stale (same caveat as the rest of
  the webview posting matrix, roadmap item 10 below).
- Chrome extension load: `npm run build:ext` output (`dist-ext/`) was rebuilt tonight
  and is current, but loading it via `chrome://extensions` → Load unpacked and clicking
  Capture on a real Zillow listing page is a one-time manual step only Dale can do.

**For Dale, tomorrow morning, 3-minute check:** `npm run dev`, install/reload the
extension from `dist-ext/`, capture one real Zillow listing, click Create Reel, click
Schedule, connect (or reuse) Facebook/Instagram/TikTok in Connect Accounts, hit Share/Post
from the Scheduler and confirm the compose window shows your video attached with caption
filled — then click Post yourself.

---

## Local Whisper made functional on Windows (2026-08-12) — FIXED, 3 real bugs found

Dale chose local/free Whisper (no OpenAI key, no per-use cost) over paying for API
transcription. The 2026-08-04 handoff blamed "needs CMake + Visual Studio Build
Tools" — turned out VS Build Tools + MSVC were **already installed** on this
machine (probably from Mymo's virtual-camera work); only CMake itself was
missing. Installed CMake 4.4.2 via winget. That alone was NOT enough — three
more bugs, found only by actually pushing a real transcription through:

1. `nodejs-whisper`'s Windows auto-downloader can't invoke its own bundled
   `download-ggml-model.cmd` via shelljs (`'download-ggml-model.cmd' is not
recognized`) — worked around by downloading `ggml-base.en.bin` (148MB,
   official `ggerganov/whisper.cpp` HuggingFace repo) directly into
   `node_modules/nodejs-whisper/cpp/whisper.cpp/models/`.
2. That same auto-downloader function **skips compiling `whisper-cli.exe`
   entirely once the model file already exists** — a real design flaw (model
   download and compiler build are one function gated only by "does the model
   exist"). Worked around by running the CMake steps directly from
   `node_modules/nodejs-whisper/cpp/whisper.cpp`: `cmake -B build` then
   `cmake --build build --config Release`.
3. **A real bug in USCut's own code**, not a dependency's:
   `electron/main/clips/transcription.ts`'s `transcribeViaLocalWhisper()`
   computed the SRT output path as `wavPath.replace(/\.wav$/, '.srt')` —
   but whisper-cli's actual default naming APPENDS `.srt` to the full
   filename (`foo.wav` → `foo.wav.srt`, not `foo.srt`). This was latent since
   2026-08-04 — the toolchain being broken meant this code path was never
   actually reached in testing before today. **If you ever touch this
   function again, verify the real whisper-cli output filename directly
   rather than trusting the replace-extension assumption.**

Verified end-to-end for real: synthesized a test line via Windows SAPI TTS,
ran it through the actual compiled `whisper-cli.exe`, got back a correct
transcript ("This is a test of local whisper transcription in U.S. Cut.").
Wired `transcribeViaLocalWhisper` as the free/keyless fallback into
`aicuts:transcribe-video` (one-click captions) and Auto-Edit's transcription
step in `electron/main/aicuts/index.ts` — mirrors the fallback chain Auto-Clip
(`clipService.ts`) already had (OpenAI key if set, else local whisper).
**Not yet Dale-verified inside the running app itself** — the compile+model+
path-fix are proven standalone; try Auto-Edit or one-click captions with no
OpenAI key configured to confirm end-to-end in the real app.

## Auto-Edit AI-provider bug (2026-08-12, same day as v1.2) — FIXED

Dale live-tested Auto-Edit and hit an auth error. Root cause:
`electron/main/aicuts/autoEdit.ts` instantiated `new Anthropic()` directly at
module scope (reads `ANTHROPIC_API_KEY` env var — never set, Dale uses
OAuth/Ollama/OpenRouter) — a leftover from before the multi-provider Settings
system existed. It was the only AI-calling code path in the app that bypassed
`resolveProvider()`. Fixed: extracted the provider-resolution closure (was
independently duplicated 3x) into one `createProviderResolver(settings)` in
`electron/main/ai/index.ts`; `autoEdit()`/`generateCaptionsFromTranscript()`
now take an injected `AIProvider` instead of reaching for a global client. This
also fixed the headless `:4255` MCP agent bridge's `/auto-edit`/`/captions`
routes, which had the same gap. **If you add a new AI-calling feature, grep for
`new Anthropic(`/`new OpenAI(` outside `electron/main/ai/` before shipping —
that's the tell for a feature silently bypassing the provider system.**
New test: `electron/main/aicuts/__tests__/autoEdit.test.ts`.

Two smaller bugs fixed same pass, both things Dale spotted live: (1) native
`window.alert()` dialogs aren't copyable in Electron on Windows — replaced all
4 call sites (Toolbar export/auto-edit, HomePage project-open) with `sonner`
toasts, matching the pattern already used everywhere else. (2) the alert
dialogs' title said "aicuts" — `app.getName()` defaulted to package.json's
`"aicuts"` (deliberately kept as an internal identifier, see decisions-log
2026-08-11); fixed with `app.setName('USCut')` in `electron/main/index.ts` —
display name only, no internal identifier touched.

**For Dale**: retry Auto-Edit after confirming Settings → AI Providers has one
connected (ChatGPT sign-in, OpenRouter OAuth, Ollama, or an API key). Not yet
live-verified.

---

## v1.2 — Company scoping, Instagram multi-account, NSIS unblocked (2026-08-12 session)

**Rebrand (AICut→USCut) committed**: was sitting uncommitted since 2026-08-11 (see
decisions-log in `C:\ClaudeClaw\.memory\`) — pure naming, no behavior change.

**NSIS installer unblocked + smoke-tested**: Dale enabled Windows Developer Mode.
`npx tsc && npx vite build && npx electron-builder --win nsis --publish never` produces
`release\0.1.0\USCut-0.1.0.exe` (~256MB) cleanly. Smoke-tested the packaged
`win-unpacked\USCut.exe` in full isolation (`--user-data-dir` + alternate ports
4256/7475, so it never touched the live dev instance on 4255/7474) — clean boot, all 3
embedded servers up, real MAS route returned correct data. **The installer wizard UI
itself was never run** — only the packaged binary underneath it. Confirm no publish
env vars (`GH_TOKEN`/`EP_*`) are present before ever running electron-builder without
`--publish never` — `electron-builder.json`'s `publish` block points at a stale
`signal1-blkink/Master_AI_Social` target that should not be live.

**Business-profile switcher (item 3 from the 2026-08-12 checkpoint) — BUILT**: global
"active company" scope, `CompanySwitcher.tsx` on Home, persisted via
`Settings.getActiveBrandId/setActiveBrandId` (`mas.settings.brand.active`). Filters
account/Page pickers on Publish, Share, and Scheduler to the active company (defaults
to "All companies" = unfiltered, original behavior). Also fixed `contentService`'s
`resolveBrandKit` — it was hardcoded to always use `profiles[0]`'s brand voice
regardless of context; now resolves the active company (falls back to `profiles[0]`
when unset, so nothing changes for anyone who never touches the switcher).

**ShareDialog Page-targeted posting (item 2) — BUILT**: editor Share button can now
post to a specific Facebook Page's timeline, same as PublishPage already could. Pure
UI wiring — the backend `pageId` param already existed and was already
live-verified via PublishPage.

**Instagram multi-account detection + switching (item 4) — BUILT, UNVERIFIED**:
mirrors the Facebook Pages pattern (`detectInstagramAccounts()` in
`electron/main/adapters/webviewBridge.ts`), but Instagram has no per-account URL —
one login can have several linked accounts, switched via an in-page menu. The
detect/switch scripts read `img[alt="{username}'s profile picture"]` in the account
switcher — best-effort DOM scraping, **never tested against a live Instagram session**
(no safe computer-use path to the running app this session — see Sphere Gotcha
below). Diagnostic logging is in place
(`[AICut] Instagram account-switcher opened`, `[AICut] Instagram account scan found
nothing...`) — **first thing to do**: open USCut, Connect Accounts → Instagram →
"Detect My Accounts", check `%APPDATA%\aicuts\logs\` if it comes back empty. Fix
surface is confined to `OPEN_ACCOUNT_SWITCHER_SCRIPT` /
`DETECT_INSTAGRAM_ACCOUNTS_SCRIPT` / `switchInstagramAccountScript` in
`webviewBridge.ts` if selectors need updating.

Also fixed a real pre-existing bug while wiring Instagram accounts in:
`ConnectAccounts.tsx`'s "Business Pages" list had no `source === 'webview'` filter at
all — any OAuth-connected account would've shown up mixed into it. Fixed at all 3
call sites (now `webviewAccounts`, filtered).

**Sphere gotcha, worth remembering**: requesting computer-use access to "Electron"
generically resolves to **Tandem Browser's** process (a different sphere — OpenClaw's),
not USCut's — USCut isn't Start-Menu-registered (launched via desktop `.vbs`), so the
app-name resolver can't target it distinctly among the several `electron.exe`-based
apps on this machine. Don't use a generic "Electron" computer-use grant against USCut —
no safe way to confirm which window actually receives clicks. Verify via direct
file/DB reads (`%APPDATA%\aicuts\config.json`, `database.sqlite` via
`node:sqlite` `DatabaseSync(..., {readOnly: true})`, discovery files) or ask Dale to
check live and report back.

**NOT verified live this session** (build/test/typecheck all clean, but no eyes-on
confirmation in the running app): ShareDialog Page-targeting, the company switcher's
actual filtering behavior, Instagram detection/switching end to end.

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

| Server                 | Port                            | Auth                  | Purpose                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAS API                | ephemeral                       | rotating bearer token | Everything under `/api/*` — publish, content, analytics, engagement, research, listings, clips, insights. Renderer gets url+token via IPC `mas:api-info`. **Discovery file (with token): `%APPDATA%\aicuts\api-port.json`** — local agents use this. |
| Listing capture server | **7474** (`AICUT_CAPTURE_PORT`) | none (loopback+CORS)  | Chrome-extension listing capture ONLY (`/api/listings/*` minus ad/video generation). Port inherited from retired BLK INK Scraper.                                                                                                                    |
| Agent bridge           | **4255** (`AICUT_BRIDGE_PORT`)  | bearer                | Video-editor ops for MCP agents (`/api/aicut/*`). Discovery: `%APPDATA%\aicuts\aicut-bridge.json`.                                                                                                                                                   |

Generated artifacts: `%APPDATA%\aicuts\{listing-reels, clips, bio-page}\`. DB:
`%APPDATA%\aicuts\database.sqlite` (TypeORM `synchronize:true` — new entities in
`electron/db/index.ts` entities array auto-create tables).

## Feature Map (v0.6) — module → API → UI

| Feature                                                     | Backend module                               | API                                                        | UI                                    |
| ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Video editor (timeline/speed/fades/export)                  | `electron/main/aicuts/`                      | bridge :4255                                               | `/editor`                             |
| AI Auto-Edit + Auto-Captions                                | `aicuts/autoEdit.ts`                         | IPC                                                        | editor AI panel                       |
| **Auto-Clip** (long video → captioned vertical shorts)      | `electron/main/clips/`                       | `POST /api/clips/auto`                                     | editor AI panel card                  |
| Publish / schedule (8 platforms, webview + OAuth)           | `publishEngine/`, `adapters/`, `scheduling/` | `POST /api/publish`                                        | `/mas/publish`, `/mas/scheduler`      |
| AI content (posts, **A/B variants**, **carousels**, images) | `content/`                                   | `POST /api/content/{generate,carousel,image}`              | `/mas/content`                        |
| **Brand Kit** (voice rules injected into every brief)       | `settings/settings.ts`                       | IPC `mas:settings:{get,set}-brand-kit`                     | `/mas/brand`                          |
| Idea Scraper + trending research                            | `research/`                                  | `GET /api/research/{scrape,trending}`                      | `/mas/research`                       |
| **Listing Scraper** (Chrome ext + paste-URL capture)        | `listings/`                                  | `POST /api/listings/capture`, `/capture-url`               | `/mas/listings` + `chrome-extension/` |
| **Generate Listing Ad** (compliance-gated copy)             | `listings/adService.ts`                      | `POST /api/listings/:id/generate-ad`                       | Listings page button                  |
| **Listing Video Generator** (photos → narrated reel)        | `listings/videoService.ts`                   | `POST /api/listings/:id/generate-video`                    | "Create Reel" button                  |
| Fair Housing / RESPA guard                                  | `listings/complianceGuard.ts`                | runs at capture + on all listing-ad output                 | shield badges                         |
| **Best-time-to-post / calendar / evergreen recycle**        | `insights/`                                  | `GET /api/insights/{best-times,calendar}`, `POST /recycle` | Scheduler page                        |
| **Competitor benchmarks** (manual snapshots)                | `insights/router.ts` + settings              | `/api/insights/competitors` CRUD                           | Analytics page                        |
| **Bio page generator** (static HTML export)                 | `insights/bioPage.ts`                        | `POST /api/insights/bio-page`                              | Brand page                            |
| Inbox (comments + AI reply drafts)                          | `engagement/`                                | `/api/engagement/*`                                        | `/mas/engagement`                     |
| Analytics snapshots                                         | `analytics/`                                 | `/api/analytics/*`                                         | `/mas/analytics`                      |
| Bulk CSV scheduling                                         | client-side                                  | (uses `/api/publish`)                                      | Scheduler page                        |
| Omobono workflow packages                                   | `workflow/`, `capcut/`                       | `/api/workflow/*`                                          | `/mas/pipeline`, `/mas/omobono`       |

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

1. ~~"Publish Reel" shortcut~~ — **DONE** (2026-08-04).
2. ~~Whisper local fallback~~ — **DONE, not yet functional** (2026-08-04): needs a
   C++ build toolchain (CMake + MSVC) on this machine to actually compile whisper-cli
   — same prerequisite as Mymo's virtual-camera phase. Degrades gracefully either way.
3. ~~Remove Background~~ — **SKIPPED (Dale's call, 2026-08-12)**: local package
   (`@imgly/background-removal-node`) is AGPLv3 — incompatible with closed-source
   commercial distribution; cloud API (remove.bg etc.) means per-frame charges
   across a whole video — real cost-surprise risk. Dale chose to skip rather than
   accept either tradeoff. Off the roadmap — don't re-raise unless Dale brings it
   up.
4. ~~Platform OAuth app registration~~ — **DEMOTED from blocker to optional
   later upgrade** (Dale's ruling, 2026-08-11): production posting path is
   webview-login-only, same as BLK INK Lead Machine. No dev-portal registration
   needed for launch.
5. ~~NSIS installer~~ — **DONE** (2026-08-12): Dale enabled Developer Mode;
   `release\0.1.0\USCut-0.1.0.exe` builds clean, packaged binary smoke-tested in
   isolation. Installer wizard UI itself still unverified (needs hands-on or a
   working computer-use path — see Sphere Gotcha above).
6. DM inbox — vendor-gated; reading/replying via a logged-in webview session is a
   materially harder build than posting (DOM scraping vs. attach+fill). Not
   scoped yet under the webview-only pivot.
7. **Business-profile switcher** — **BUILT 2026-08-12, unverified live**: see v1.2
   section above. Extended same session to Analytics (account picker) +
   Competitor Benchmarks (per-entry company assignment) — was previously only
   Publish/Share/Scheduler + AI briefs. tsc/eslint/tests/build all clean; NOT
   yet Dale-verified live.
8. **ShareDialog Facebook Page-targeting** — **BUILT 2026-08-12, unverified live**.
9. **Instagram multi-account switching** — **BUILT 2026-08-12, genuinely unverified**
   (DOM-scraping, no live test yet) — see v1.2 section above, this is the most
   likely thing to need a follow-up fix.
10. **Per-platform webview posting verification** — only X and LinkedIn have
    confirmed auto-submit; Pinterest/YouTube/TikTok/Snapchat/Threads flows were
    built 2026-07-12 and never live-verified against current DOM. Long-standing
    gap, not new this session.

## How to Work With Dale

Direct, systems-thinker, automation-first. Verify in the running app before claiming done
(launch `npm run dev`, hit the API with the token from `api-port.json`, probe outputs with
ffprobe). Commit messages: what shipped + what was verified. Push = `push-v4-2:main`.
Flag anything legally sensitive (compliance, platform ToS) before building it.
