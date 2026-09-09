# USCut — Handoff for Silas (ChatGPT agent)

**From:** Mick / ClaudeClaw
**Date:** 2026-09-07
**Repo state at handoff:** HEAD `70f011b` on local branch `push-v4-2`, **even with `origin/main`**, working tree clean.
**Health:** `npx tsc --noEmit` clean · `npx vitest run` = **462 passed / 12 skipped (474)** · last verified 2026-09-07.

Read `AGENT-HANDOFF.md` (repo root) next for full architecture, the feature map, and the runtime topology. This doc is the *what's-done / what's-left* layer on top of it, and it captures ~11 commits of Aug 25–26 work that never made it into a handoff or Mick's session memory.

---

## 1. What USCut is (30-second version)

Electron 33 + React 18 + Vite + TypeScript + TypeORM(better-sqlite3) + fluent-ffmpeg desktop app. A CapCut-class video editor with a Buffer/Opus-Clip-style social automation suite bolted on, leaning real-estate. Fully local-first: FFmpeg, SQLite, Windows SAPI TTS all run on-device; AI-provider keys are optional and features degrade gracefully without them.

- **Path:** `C:\home\dalebrown138\projects\Social-Engine-USCut` (Windows-native — NOT WSL).
- **GitHub:** `signal1project/USCut`, branch `main`.
- **Branch quirk:** work happens on local `push-v4-2`; push with `git push origin push-v4-2:main` (fast-forward).
- **Run:** `npm run dev` (use `dev`, not `dev:mac` — `dev` has the `chcp 65001` UTF-8 fix). After a fresh `npm install`, run `npm run rebuild` (better-sqlite3 → Electron ABI).
- **Internal identifiers stay `aicut`/`aicuts`** on purpose (IPC prefix `aicuts:*`, `aicut-media://`, `%APPDATA%\aicuts\`, discovery files, env vars, npm package name). Dale's ruling — closed, don't re-raise. "USCut" is display-name only.

Three embedded loopback servers: **MAS API** (ephemeral port, rotating bearer, `%APPDATA%\aicuts\api-port.json`), **listing capture server :7474** (no auth, loopback+CORS, Chrome-extension capture only), **agent bridge :4255** (bearer, MCP video-editor ops). Details in `AGENT-HANDOFF.md` → Runtime Topology.

---

## 2. The flagship feature — Zillow listing → social reel pipeline

This is the capability USCut was split off to build and it's the most battle-tested part of the app. Flow:

**Chrome extension captures a Zillow `/homedetails/` page → `:7474/api/listings/capture` → `listingStore` → `ListingVideoService` (real ffmpeg) → 1080×1920 h264+AAC mp4 → "Post Now" opens Publish prefilled with the local video → CDP-attaches it to FB/IG/TikTok webview windows → Dale clicks the final Post himself.**

- Narrowed to **Zillow-only** (Dale's call 2026-08-14 — Realtor.com/Redfin content scripts removed).
- FB/IG/TikTok are deliberately `autoSubmit: false` — only X and LinkedIn auto-submit. Everything else is attach + fill caption + leave the window for a human click. This is intended design, not a gap (composer DOM shifts too often to trust auto-click).
- `Schedule` (unattended) works for **API-connected accounts only**; webview-only accounts are excluded from the Scheduler picker with an honest message.

### Reel templates (rebuilt 2026-08-26, commit `1b9da7a`)
`ReelTemplate` is now 5 CapCut-style options (`electron/main/listings/videoService.ts:44`):
`just-listed` · `gallery` · `viral` · `room-flow` · `luxury`

- The old opt-in `reel-spec` template was **folded into `room-flow` (standard tier) and `luxury` (gold-serif/slow-dissolve tier)**. Price tier is no longer caller-configurable — **picking the template picks the tier**.
- `room-flow`/`luxury` use room-bucketed photo classification (`video/roomBuckets.ts`), `photoCaptions` from the extension, optional **Kokoro-82M local neural narration** (`video/kokoroNarration.ts`, first-run ~89MB model download, falls back SAPI → none), music beds from a configurable music dir, and a branded intro card from the active brand kit.
- Photos are now **composited over a blurred pillarbox** instead of force-cropped (commit `86007d2`).

### Aug 25–26 work not previously logged anywhere
| Commit | What |
|---|---|
| `21a8061` | Narration on/off toggle, address masking, CTA presets on reels + ads |
| `4526e94` | **Configurable storage locations** + per-listing property folders (`listingFiles.ts`, Settings page UI, `propertyListing` schema field). Generated media + downloaded photos now land in a per-property folder under a user-chosen root. |
| `ddd47ac` | Zillow scraper hardening: schema drift, photo pollution, low-res photo upgrade, more SPA-staleness handling |
| `1b094dc` | **Photo/description picker with reel-order controls** in the Zillow Scraper UI (`ListingScraperPage.tsx`) — curate and reorder which shots go in the reel before generating |
| `86007d2` | Blurred-pillarbox compositing (above) |
| `1b9da7a` | 5-template rebuild + branded intro (`video/brandIntro.ts`, `video/viralText.ts`) |
| `d71f419` | Fix: AI briefs never actually received the brand/company name (`contentService.ts`) |
| `70f011b` | Scope: dropped LinkedIn from Zillow listing-ad generation — Meta-only for now |

Also earlier in the same arc: `2d5131a` wired publish/schedule/accounts API for external MCP callers; `4d651aa` gave listing reels agent-facing creative controls; `9578c27` closed the "Opus Clip" gap in the auto-clip pipeline.

---

## 3. What's DONE (by area)

**Editor** — full CapCut-parity: timeline, per-clip speed/fades/volume, undo/redo (drag-coalesced), caption styling + preview, image/overlay/PiP/watermark with placement sliders, color presets + chroma key + zoompan motion, real cached waveforms, `aicut-media://` protocol for webSecurity-safe playback, preview proxies for HEVC/odd containers, silent project autosave + Save As + Recent Projects.

**Export engine v2** — single ffmpeg `filter_complex` graph (`aicuts/exportGraph.ts`, pure + unit-tested): music/fades/gaps/aspect presets (16:9/9:16/1:1/4:5 × 720p/1080p/4K)/xfade+acrossfade transitions with `compressTime()` mapping/ASS caption burn-in.

**ffmpeg binary** — resolves to `ffmpeg-static` (modern, has xfade) via `electron/util/ffmpegBinary.ts` using `createRequire(import.meta.url)`. **Do not revert to bare `require('ffmpeg-static')`** — under the ESM main-process bundle it throws `ReferenceError: require is not defined`, is silently caught, and falls through to a 2018 binary with no xfade. Vitest can't catch this (tests run under plain Node where bare `require` exists).

**AI providers** — ChatGPT sign-in (Codex device-code OAuth, gpt-5.5, no key) + OpenRouter OAuth + Ollama + API keys (Claude/OpenAI/Groq). Managed on `/mas/settings`. Every AI feature resolves through `createProviderResolver(settings)` in `electron/main/ai/index.ts` — **grep for `new Anthropic(` / `new OpenAI(` outside `electron/main/ai/` before shipping any new AI feature**; that's the tell for a feature bypassing the provider system (Auto-Edit had this bug).

**Auto-Edit / Auto-Captions** — content-aware: pulls the real transcript (Whisper via OpenAI key, else local whisper.cpp fallback, else degrades with a nudge), injects per-platform algorithm playbooks (`electron/main/algorithm/platformPlaybooks.ts`) via `detectPlatform()` keyword-matching the user's prompt, and top-10 keyless Google Trends keywords.

**Local Whisper** — compiled and proven working end-to-end standalone on this machine (CMake 4.4.2 + pre-existing MSVC). Model `ggml-base.en.bin` sits in `node_modules/nodejs-whisper/cpp/whisper.cpp/models/`. Wired as the keyless fallback for captions + Auto-Edit. **Caveat:** `transcription.ts` had a real bug (whisper-cli appends `.srt` to the full filename, doesn't replace the extension) — fixed, but re-verify the real output filename if you ever touch that function.

**Publish / Schedule** — 8 platforms, webview + API paths. Webview posting via CDP `DOM.setFileInputFiles` (pierces iframes/shadow DOM). Scheduled posts rehydrate at boot + catch up missed ones; the QUEUED→PUBLISHING→PUBLISHED/FAILED transition fix closed a latent double-post bug.

**Company scoping** — global "active company" switcher (`CompanySwitcher.tsx` on Home), `Settings.getActiveBrandId/setActiveBrandId`. Filters account/Page pickers on Publish, Share, Scheduler, Analytics; resolves the right brand voice in `contentService.resolveBrandKit`.

**Meta identity** — Facebook/Instagram/Threads share one Electron session partition (`persist:social-meta`). Threads connected-status reads Instagram's cookie (Threads has no session cookie of its own — verified via live diagnostic logging). Facebook Page auto-detection + per-Page company assignment. **Dale confirmed Meta is connected and working live (2026-08-12).**

**Chrome extension** — real in-app guided install flow (Build / Open-Chrome / Show-folder buttons on the Zillow Scraper page), auto-bumping patch version on every `npm run build:ext` so Chrome's extensions page shows whether a reload took. Web Store submission package prepped in `docs/CHROME-WEB-STORE-SUBMISSION.md`.

**Compliance** — Fair Housing Act + RESPA guard (`listings/complianceGuard.ts`) runs at capture time AND on all generated listing-ad copy. Blocked copy returns flagged `complianceOk:false`, UI marks it "blocked — do not publish". **NEVER remove or bypass this gate** — extend patterns instead (tests in `__tests__/complianceGuard.test.ts`).

**NSIS installer** — `npx tsc && npx vite build && npx electron-builder --win nsis --publish never` produces `release\0.1.0\USCut-0.1.0.exe` (~256MB) clean; packaged binary smoke-tested in isolation. **Always pass `--publish never`** and confirm no `GH_TOKEN`/`EP_*` env vars — `electron-builder.json`'s publish block points at a stale `signal1-blkink/Master_AI_Social` target that must not go live.

---

## 4. What's LEFT (open items, roughly prioritized)

### A. Needs Dale's hands, not code
1. **Live posting through FB/IG/TikTok webview windows** against his real logged-in sessions. Selectors are best-effort, never live-tested against current platform DOM. Only X + LinkedIn have confirmed auto-submit; Pinterest/YouTube/TikTok/Snapchat/Threads flows built 2026-07-12, never live-verified.
2. **One real Zillow capture** — load `dist-ext/` in Chrome, open a `/homedetails/` page, clear Zillow's press-and-hold anti-bot challenge, click Capture, then Create Reel → Post Now. Zillow's parser (`chrome-extension/content/zillow.ts`) drifts periodically; the paste-URL fallback (schema.org/OpenGraph) is the safety net.
3. **Instagram multi-account detection/switching** — BUILT but genuinely never tested against a live Instagram session. DOM-scraping `img[alt="{username}'s profile picture"]` in the account switcher. Diagnostic logging is in place (`[AICut] Instagram account-switcher opened` / `...scan found nothing`). First step: Connect Accounts → Instagram → "Detect My Accounts", check `%APPDATA%\aicuts\logs\`. Fix surface confined to `OPEN_ACCOUNT_SWITCHER_SCRIPT` / `DETECT_INSTAGRAM_ACCOUNTS_SCRIPT` / `switchInstagramAccountScript` in `electron/main/adapters/webviewBridge.ts`.
4. **Music beds** — `public/assets/music/{standard,luxury}/` still contain only `README.md`. Dale was sourcing tracks. Note: `4526e94` added a configurable music dir in Settings, so tracks may live elsewhere now — check `Settings → storage locations` before assuming they're missing. Empty resolves to narration-only silently.
5. **Kokoro narration** in the real running app — proven standalone, not yet driven through a live reel generation by a human.
6. **NSIS installer wizard UI** — only the packaged binary underneath it was smoke-tested, never the actual install flow.
7. **Chrome Web Store submission** — package is prepped; needs Dale's own Google Developer account + screenshots.
8. **Create Reel options panel** (template / photo picker / reorder controls) — plumbing proven via live API test, panel itself never human-click-tested.
9. **ShareDialog Facebook Page-targeting** + **company switcher filtering** — BUILT, tsc/tests clean, no eyes-on confirmation in the running app.

### B. Deferred / explicitly not doing
- **Remove Background** — OFF the roadmap (Dale's call). Local package is AGPLv3 (incompatible with closed-source commercial); cloud API = per-frame billing risk. Don't re-raise unless Dale brings it up.
- **DM inbox** — vendor-gated; reading/replying via a logged-in webview session is DOM-scraping, a materially harder build than posting. Not scoped under the webview-only pivot.
- **Platform OAuth app registration** — demoted from blocker to optional later upgrade. Production posting path is webview-login-only, same as BLK INK Lead Machine.

### C. Housekeeping worth doing
- **`npm run lint` is not clean** — `npx eslint` reports Prettier-formatting drift (e.g. ~32 issues under `electron/main/listings/`, all auto-fixable with `--fix`). tsc and tests are clean; this is cosmetic drift from the Aug 25–26 sprint. Run `npm run lint:eslint` (has `--fix`) + `npm run lint:prettier` and commit the mechanical result before layering new work on those files. Note: this project's real lint config only globs `{src,mocks,electron}` — the top-level `test/` dir is not eslint-covered.
- **`docs/USER-GUIDE.md` still says "AICut"** in its heading and body — never updated after the rebrand. Update when touching user-facing docs.
- **`handoffs/AGENT-HANDOFF.md`** is a stale 2026-06-06 Phase-A doc. The live one is `AGENT-HANDOFF.md` at repo root. Consider deleting the stale copy.
- Mick's memory (`C:\ClaudeClaw\.memory\{active-tasks,decisions-log}.md`) has no entry for the Aug 25–26 commits — this doc is the record of that gap.

---

## 5. Gotchas that will bite you

1. **No safe computer-use path to USCut's window.** USCut isn't Start-Menu-registered (launched via desktop `.vbs`), so a generic "Electron" computer-use grant resolves to **Tandem Browser** (a different sphere — OpenClaw's) or another `electron.exe` app, not USCut. Verify live state via direct reads instead: `%APPDATA%\aicuts\config.json`, `database.sqlite` via `node:sqlite` `DatabaseSync(path, {readOnly: true})`, the discovery files, or ask Dale to check the running window.
2. **Zombie Electron processes.** Every main-process file save triggers vite-plugin-electron's auto-relaunch. Close-to-tray used to intercept the quit and orphan the old process invisibly — the *oldest* survivor holds fixed port :7474 while Dale's visible window is a newer process, so `BrowserWindow.getAllWindows()` broadcasts never reach his window. This was flipped to **X-quits-for-real by default** (minimize is the dedicated tray action), but if a "should just work" live-update feature doesn't: check `Get-Process electron` / `Get-NetTCPConnection -LocalPort 7474` and verify every PID's command line is *this repo's* `node_modules\electron\dist\electron.exe` before killing anything.
3. **Verify via the real browser `fetch()` path, not curl.** The renderer always sends an `Authorization` header, forcing a CORS preflight. A curl/HTTP-script "live verification" bypasses CORS entirely and misses an entire class of bug (the MAS API had zero CORS support and it was invisible to every prior curl-based check). Boot the real dev app and drive it as the UI would.
4. **DB tests auto-skip under plain Node** (`masSchema`, `listingStore`) — that ABI mismatch is expected, follow the `describe.skipIf(!nativeLoads)` pattern. 12 skipped tests is the normal state, not a failure.
5. **Sphere boundaries** — USCut is inside Mick's/Dale's sphere but this machine also runs OpenClaw (:18789, :3587), HermesClaw (WSL :9119), 9router (WSL :20128). Never bind a port without checking `Get-NetTCPConnection` first; never touch another sphere's files/processes.
6. **Commit at the end of every clean build** (tsc + tests + build green) without waiting to be asked — a local commit is a cheap checkpoint. **Push still needs Dale's explicit per-task go-ahead.** Split commits by feature; commit messages state the honest verification tier.

---

## 6. Suggested first moves for Silas

1. `npm run dev`, confirm all 3 embedded servers bind clean (`%APPDATA%\aicuts\logs\`), no port conflicts.
2. Run `npm run lint:eslint && npm run lint:prettier`, commit the mechanical formatting cleanup (item 4C) so the tree is genuinely clean.
3. Ask Dale which of §4-A he wants to drive live next — Instagram detection (#3) and the Create Reel options panel (#8/#9) are the highest-value unverified surfaces and both need a running app + his eyes.
4. Whatever you build: `npx tsc --noEmit` + `npx vitest run` (expect 462+/474) + drive it through the *real* app before claiming done.
