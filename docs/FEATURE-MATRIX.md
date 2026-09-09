# USCut — supported feature matrix

What ships, what it needs, and how proven. For the release-candidate audit and
customer-facing "what USCut does" copy.

Legend: **Local** = runs on-device, no account. **AI** = needs an AI provider
connected in Settings (ChatGPT sign-in / OpenRouter / Ollama / API key).
**Webview** = signs in inside USCut like a normal browser, user clicks the final
Post.

## Editor

| Feature | Needs | Verified by |
|---|---|---|
| Timeline editing, per-clip speed / fades / volume | Local | unit + editorStore tests |
| Undo/redo (drag-coalesced) | Local | `editorStoreHistory` tests |
| Caption styling + live preview, image / overlay / PiP / watermark | Local | unit tests |
| Colour presets, chroma key, zoom/pan motion | Local | `exportGraph` + ffmpeg e2e |
| Real cached waveforms | Local | audioTools tests |
| HEVC / odd-container playback (`aicut-media://` + preview proxies) | Local | `verify-media-protocol` harness |
| Project autosave, Save As, Recent Projects | Local | `projectPersistence` + smoke |
| Project recovery (previous-valid `.json.bak`, corrupt-primary fallback) | Local | `projectStorage` tests + smoke |
| **Portable backup / restore** (`.uscut.zip` = project + all media) | Local (Windows) | `projectArchive` unit + e2e + smoke |

## Export

| Feature | Needs | Verified by |
|---|---|---|
| Single `filter_complex` graph: music, fades, gaps, aspect (16:9/9:16/1:1/4:5 × 720p/1080p/4K), xfade/acrossfade transitions, ASS caption burn-in | Local | `exportGraph` unit + real-ffmpeg e2e |
| Background export jobs (toolbar **and** editor Share): queue, progress, cancel, atomic temp-file commit, crash-interrupt marking | Local | `exportJobs` tests + smoke (real FFmpeg killed mid-render) |
| Startup GC of crash-orphaned partial renders | Local | `startupCleanup` tests + smoke |

## AI production

| Feature | Needs | Verified by |
|---|---|---|
| **Production Studio**: brief → storyboard → narrated multi-track USCut project | AI (storyboard) / Local (manual scenes) | `studio` unit + smoke |
| Frame-grounded planning (samples clips, feeds a vision provider) | AI with vision (Claude / OpenAI) | `studioVision` e2e |
| Single-scene AI revision | AI | `studio` unit |
| Music beds (loop/trim to length, tail fade) | Local | `studioMusic` e2e + smoke |
| Versioned production documents (save / restore version / list / delete, 40-version history) | Local | `studioDoc` unit + smoke |
| Local Windows SAPI narration | Local (Windows) | ffmpeg e2e + smoke |
| Auto-Edit / Auto-Captions (transcript-grounded, platform playbooks, trends) | AI; transcript uses OpenAI Whisper key **or** bundled local whisper.cpp | `autoEdit` tests + smoke |
| Auto-Clip (long video → vertical shorts, durable jobs) | AI for highlight picking; transcript as above | `clipService` e2e + smoke |
| ElevenLabs narration upgrade | ElevenLabs API key | provider tests |
| Kokoro-82M local neural narration (listing reels) | Local (first-run model download ~89 MB) | reel-spec e2e |
| ❌ **Generated footage (text-to-video)** | — | **not built** — needs a provider + spend controls (Dale) |

## Listings → social reel (flagship)

| Feature | Needs | Verified by |
|---|---|---|
| Zillow `/homedetails/` capture (Chrome extension → `:7474`) + paste-URL fallback | Local | listingStore tests; one real capture still needs Dale |
| 5 reel templates (`just-listed` / `gallery` / `viral` / `room-flow` / `luxury`), room-bucketed photos, blurred pillarbox, branded intro | Local | `videoService` + `videoService.reelSpec` e2e (17 cases) |
| Photo / description picker + reel-order controls | Local | UI; plumbing e2e-covered |
| Fair Housing + RESPA compliance guard (capture time **and** generated copy) | Local | `complianceGuard` tests |
| Listing-ad copy generation (Meta-only) | AI | `listingAdService` tests |

## Publish / schedule

| Feature | Needs | Verified by |
|---|---|---|
| 8-platform publish (webview + API paths) | Webview sign-in or platform OAuth | webviewBridge; **live per-platform posting not yet verified** |
| CDP media attach (pierces iframes / shadow DOM) | Webview | design-reviewed; X + LinkedIn auto-submit confirmed, others attach + manual Post |
| Scheduled posts: rehydrate at boot, catch up missed, QUEUED→PUBLISHING→PUBLISHED/FAILED | API-connected accounts only | scheduledFiring tests |
| Company scoping (active-company switcher filters account/Page pickers) | Local | settings tests |
| Meta identity sharing (FB/IG/Threads one session), Facebook Page auto-detection | Webview | Dale-confirmed live 2026-08-12 |
| Instagram multi-account detect/switch | Webview | **built, never live-verified** |

## Subscription

| Feature | Needs | Verified by |
|---|---|---|
| Offline entitlement verification (ed25519), 14-day offline grace, Settings activate/deactivate | Local | `entitlement` crypto + state-machine tests + smoke |
| Hosted checkout, Stripe webhook → issue entitlement | **Dale**: Stripe account, price, deployed signing key | `services/licensing` scaffold + lifecycle test only |
| Feature gating enforcement | product decision | **not wired** — status surfaced, nothing locked |

## Platform

- Windows 10/11 x64 only (SAPI, whisper-cli.exe, PowerShell zip, readiness checks).
- Three embedded loopback servers: MAS API (ephemeral port + rotating bearer),
  listing capture `:7474`, agent bridge `:4255`.
- NSIS installer; `deleteAppDataOnUninstall: false` (uninstall keeps customer data).
- Auto-update via GitHub releases — **needs a code-signing certificate** before
  signed updates can be validated.
