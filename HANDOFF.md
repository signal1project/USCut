# USCut — Agent Handoff File
_Last updated: 2026-06-26_

## Project Identity
- **App name:** USCut
- **Purpose:** CapCut-style desktop video editor with AI features and direct social publishing
- **Stack:** Electron 33 + React 18 + Vite + Zustand + Tailwind 4 + fluent-ffmpeg + better-sqlite3
- **Local path:** `C:\home\dalebrown138\projects\Social-Engine-USCut`
- **GitHub:** https://github.com/signal1project/USCut (`main` branch)
- **Latest commit:** `1fa88cf` (orphan push — old git objects were corrupted from WSL→Windows rsync; no history loss, clean working tree)

## Run Commands
```
npm run dev          # Dev server (Electron + Vite HMR)
npm run rebuild      # Rebuild native modules after npm install (better-sqlite3 + Electron ABI)
npm run package:win  # Build USCut.exe → release\USCut-win32-x64\USCut.exe
```

## Architecture Overview

### Entry Points
- `src/main.ts` — Electron main process
- `src/preload.ts` — IPC bridge (use `src/lib/ipc.ts` safe accessor — never call `window.ipcRenderer` directly)
- `src/renderer.tsx` — React root
- `src/App.tsx` — Router: `/` → HomePage, `/editor` → Editor

### Key Files
| File | Purpose |
|---|---|
| `src/views/home/HomePage.tsx` | Project hub (CapCut-style home screen) |
| `src/views/editor/` | Full editor UI (timeline, panels, toolbar) |
| `src/store/editorStore.ts` | Zustand store — all editor state |
| `src/types/index.ts` | `Clip`, `Track`, `Project` types (Clip.speed, fadeIn, fadeOut live here) |
| `src/lib/ffmpeg.ts` | FFmpeg export pipeline (speed, fade filters) |
| `src/lib/ipc.ts` | Safe IPC accessor (guards against Electron preload missing) |
| `src/components/panels/PropertiesPanel.tsx` | Speed + fade controls |
| `src/components/panels/AIPanel.tsx` | Auto-Captions, AI Auto-Edit, stubs |
| `src/components/panels/EffectsPanel.tsx` | Fade explainer + upcoming stubs |
| `src/components/layout/TitleBar.tsx` | Home breadcrumb button |
| `src/bridge/server.ts` | Agent REST API server (port 4255) |

### Agent Bridge (port 4255)
- REST API on `127.0.0.1:4255` — bearer auth
- Discovery file: `%APPDATA%\aicuts\aicut-bridge.json` (url + token + pid)
- Used by Hermes/Omobono to drive USCut programmatically
- MCP wrapper: `Social-Engine-AICut-Hermes` (6 tools, tested end-to-end; sibling repo not yet renamed)

### Social Onboarding
- OAuth-ONLY — no API keys (hard rule for all Dale's agents)
- `ConnectAccounts.tsx` modal — 8 platforms
- Backend: DB init + `registerMasIpc` only (NOT full publish/analytics runtime)
- Live OAuth still needs Dale to register client IDs at each platform's dev portal

## Features Shipped (as of 2026-06-26)

### CapCut Parity Gaps — All Closed
1. **Home screen** — CapCut-style project hub at `/`
2. **Speed control** — 0.25x–4x per clip; FFmpeg `setpts` + `atempo` chain on export; badge on timeline clip
3. **Fade transitions** — fadeIn/fadeOut per clip; FFmpeg `fade` filter burned on export
4. **AI panel** — Auto-Captions (working: transcript → Claude → caption clips), AI Auto-Edit, Remove BG stub, Voice Studio stub
5. **Effects panel** — Fade explainer + upcoming feature stubs (replaced dead "Coming soon")

### USCut Advantages Over CapCut
- Local FFmpeg processing (no upload)
- Claude auto-edit
- Direct 8-platform social publishing
- Agent REST API `:4255` + MCP wrapper
- No watermark, no subscription

## Open Items

### Blocked on Dale's Decision
- **Omobono bridge (WSL → Windows):** WSL NAT can't reach USCut's bridge via localhost. Three options:
  1. *(Recommended)* WSL HTTP-MCP proxy on `:4256` + rebind USCut bridge to `0.0.0.0`
  2. WSL mirrored networking — affects other spheres, Dale must approve
  3. Defer
  Dale has not chosen yet.

### Blocked on Dale's Action
- OAuth app registration — Meta, X, LinkedIn, TikTok, YouTube, Pinterest, Instagram, Snapchat (each dev portal separately)
- Nehemiah GHL credentials → `~/.hermes/profiles/nehemiah/.env`

### Future Build-Out (non-blocking)
- Whisper auto-transcription (nodejs-whisper or HTTP API) — makes Auto-Captions fully automatic
- Remove Background — rembg or ML equivalent
- Voice Studio — ElevenLabs TTS
- Publish from editor — "Share" button → platform picker → BLK-INK pipeline
- Export smoke test — needs a sample video file
- Windows NSIS installer (needs Developer Mode/admin; `package:win` workaround works for now)

## Sphere & Port Rules (CRITICAL)
This project belongs to the **ClaudeClaw / Mick** sphere.
- USCut agent bridge: `127.0.0.1:4255` — USCut's port, do not move without checking sphere rules
- Do NOT touch `C:\Users\Dale\.openclaw\`, OpenClaw port `18789`, Mission Control port `3587`, HermesClaw `~/.hermes/` port `9119`, or 9router port `20128`
- OAuth only — never suggest API keys for any auth flow
- Read other spheres' configs to diagnose; never write without Dale's explicit per-task approval

## Operator Context
- **Dale Brown** — CEO, The Family Office; 20 years mortgage/real estate/SMB ops
- **AI executive:** Mick (Claude Code CLI, ClaudeClaw sphere)
- **Memory files:** `C:\ClaudeClaw\.memory\active-tasks.md` + `decisions-log.md` (read at session start)
