# USCut — release-candidate audit checklist

Run top to bottom on a **clean Windows 10/11 x64 machine** (or fresh VM) before
any public sale. Record the result and date next to each line. Nothing here is a
substitute for the item owner's sign-off.

## 0. Prerequisites resolved (Dale)

- [ ] FFmpeg licence path chosen and implemented (`docs/LICENSE-INVENTORY.md` row 1)
- [ ] Proprietary EULA replaces the MIT `LICENSE`; `package.json` `"license"` fixed
- [ ] `NOTICES/` bundled (whisper.cpp MIT, Apache NOTICEs, OFL fonts, Chromium `LICENSES`, FFmpeg text if kept)
- [ ] Code-signing certificate obtained; `electron-builder` configured to sign the installer + updates
- [ ] Stripe account live; price/currency set; `services/licensing` deployed with the private signing key; webhook registered
- [ ] Seller identity + support email in the installer metadata and the app "About"
- [ ] Text-to-video provider + spend cap decided (or "generated footage" cut from launch scope explicitly)

## 1. Build

- [ ] `npm ci` on a clean checkout
- [ ] `npm run rebuild` (better-sqlite3 → Electron ABI)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — expected **549+ passed / 12 skipped**
- [ ] `node scripts/test-database-upgrades.mjs` — 4 scenarios pass under the Electron ABI
- [ ] `npx vite build` clean
- [ ] `npx electron-builder --win nsis --publish never` completes; **no `GH_TOKEN`/`EP_*` env vars**
- [ ] `afterPack` (`verify-packaged-runtime.cjs`) prints "Packaged FFmpeg and Whisper start successfully"
- [ ] installer is **signed** (once the cert is in place)

## 2. Packaged app

- [ ] `node scripts/smoke-stabilization.mjs "release/<v>/win-unpacked/USCut.exe"` — all PASS lines
- [ ] Launch `win-unpacked/USCut.exe` directly with no dev tools on PATH — boots, all 3 embedded servers bind
- [ ] Old-schema upgrade: point the packaged app at a profile with a `synchronize`-built `database.sqlite` (no `migrations` table) → boots, rows preserved, `migrations` table populated, `database-backups/before-upgrade-*.sqlite` written

## 3. Installer lifecycle (clean machine)

- [ ] Fresh install: shortcuts created, launches, first-run DB init clean
- [ ] In-place update over a prior version: settings + projects + connected accounts survive
- [ ] Uninstall: app removed, **`%APPDATA%\aicuts\` (projects, settings) preserved** (`deleteAppDataOnUninstall: false`)
- [ ] Reinstall after uninstall: previous data still there

## 4. Core workflows (real, on the clean machine)

- [ ] Import → cut → background export → file opens and plays
- [ ] Studio: brief + footage → storyboard → build → open in editor → export
- [ ] Studio with a music bed and local narration → 4 tracks, plays
- [ ] Project **Back up** → move the `.uscut.zip` to another folder → **Restore from backup** → plays with zero missing media
- [ ] Auto-Edit and one-click captions with the bundled local Whisper (no API key)
- [ ] Kokoro narration on a listing reel (first-run model download)

## 5. Listings → social (Dale's hands)

- [ ] Build + load the Chrome extension; capture **one real Zillow listing**
- [ ] Create Reel → Post Now → attach to a real Facebook / Instagram / TikTok window → click Post
- [ ] Paste-URL fallback works when the extension parser drifts
- [ ] Fair Housing / RESPA guard blocks a deliberately non-compliant description

## 6. Subscription (test mode)

- [ ] Stripe test checkout → webhook issues an entitlement → `/activate` returns it
- [ ] Paste the key in Settings → Subscription → state `active`, correct email/plan/expiry
- [ ] Simulate expiry → state `grace` for 14 days, then `expired`
- [ ] Tampered / wrong-key token → state `invalid`
- [ ] Remove from device → `unlicensed`
- [ ] (When feature gating is wired) premium features lock/unlock with state

## 7. Release

- [ ] Auto-update from the prior signed release validates the signature and applies
- [ ] Release notes published
- [ ] Support channel monitored

## Known non-blockers to disclose

- Live per-platform webview posting selectors are best-effort against current DOM (only X + LinkedIn auto-submit).
- Instagram multi-account detection is built but never verified against a live session.
- Generated footage (text-to-video) is not in this build.
- Feature gating by subscription state is not wired (status is shown, nothing is locked).
