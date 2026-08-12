# USCut → Omobono Agent Handoff
_Date: 2026-06-26 | Author: Mick (ClaudeClaw) | For: Omobono (HermesClaw)_

---

## What USCut Is

USCut is Dale's desktop AI video editor + social media publishing engine. It runs on Windows as an Electron app. Think CapCut, but:

- Runs 100% locally — no cloud uploads
- Claude AI drives auto-edit and caption generation
- Built-in Social Hub publishes to 8 platforms (Facebook, Instagram, Twitter/X, LinkedIn, Threads, Pinterest, YouTube, TikTok)
- Has a **headless REST API bridge on port 4255** specifically so agents like you can drive it

**Stack:** Electron 33 + React 18 + Vite + Zustand + Tailwind + fluent-ffmpeg + better-sqlite3

**Location on disk:** `C:\home\dalebrown138\projects\Social-Engine-USCut\`

**GitHub:** https://github.com/signal1project/USCut

---

## What Is Already Built for You

### 1. Agent Bridge — REST API on port 4255

When USCut is running, it exposes a loopback HTTP server on `127.0.0.1:4255` with the following routes (all require Bearer auth):

| Method | Route | What it does |
|--------|-------|--------------|
| `GET` | `/api/aicut/info` | Liveness check + capability list |
| `POST` | `/api/aicut/probe` | Probe a video file → duration, resolution, hasAudio |
| `POST` | `/api/aicut/thumbnail` | Extract thumbnail at a timestamp |
| `POST` | `/api/aicut/auto-edit` | AI auto-edit — give it clips + a prompt, get back trim/arrange decisions |
| `POST` | `/api/aicut/captions` | Generate caption segments from a transcript |
| `POST` | `/api/aicut/export` | Headless export to MP4/MOV at 720p/1080p/4K |

There is also a full **Social Hub API** (separate server, random loopback port):

| Method | Route | What it does |
|--------|-------|--------------|
| `POST` | `/api/publish` | Publish or schedule a post to connected accounts |
| `GET` | `/api/research/trending` | Get trending signals per platform |
| `GET` | `/api/research/scrape?keyword=X` | Scrape Google News for content ideas |
| `GET` | `/api/analytics/...` | Post analytics |
| `GET` | `/api/scheduling/...` | Scheduled post queue |

### 2. Discovery File

When USCut boots, it writes two discovery files:

**Agent bridge info:**
```
%APPDATA%\aicuts\aicut-bridge.json
```
Contents:
```json
{
  "url": "http://127.0.0.1:4255",
  "port": 4255,
  "token": "<bearer-token>",
  "pid": 12345,
  "startedAt": "2026-06-26T..."
}
```

**Social Hub API info:**
```
%APPDATA%\aicuts\api-port.json
```
Contents:
```json
{
  "port": 7800,
  "pid": 12345,
  "startedAt": "2026-06-26T..."
}
```

Read these files to get the current URL and token before making requests.

### 3. MCP Wrapper (built, needs registration)

An MCP tool wrapper was scaffolded at:
```
C:\home\dalebrown138\projects\Social-Engine-USCut\scripts\omobono-electron-smoke.cjs
```

This exposes USCut's bridge as MCP tools so Omobono can call them natively.

---

## The Networking Problem You Need to Solve

**USCut runs on Windows. You (Omobono/HermesClaw) run in WSL Ubuntu.**

`127.0.0.1:4255` from inside WSL does NOT reach Windows localhost by default — WSL uses a NAT that creates a separate network namespace.

### Option A — WSL HTTP-MCP Proxy (Recommended)

Run a tiny proxy inside WSL on port 4256 that forwards requests to the Windows bridge. Steps:

1. Get the Windows host IP from inside WSL:
   ```bash
   cat /etc/resolv.conf | grep nameserver | awk '{print $2}'
   # Usually something like 172.28.xxx.xxx
   ```

2. Rebind USCut's bridge to `0.0.0.0` instead of `127.0.0.1` so it's reachable from WSL.
   - Edit `electron/main/aicuts/agentApi.ts` → the `startApiServer` call in `index.ts`
   - Or set env var `AICUT_BRIDGE_HOST=0.0.0.0` if supported
   - **Ask Dale to approve this change first** — it changes the bridge bind address

3. From WSL, call Windows directly:
   ```bash
   WINDOWS_HOST=$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}')
   curl -H "Authorization: Bearer <token>" http://$WINDOWS_HOST:4255/api/aicut/info
   ```

4. Register this as an MCP server in your Hermes profile.

### Option B — Windows Mirrored Networking

Set WSL to mirrored mode (makes `127.0.0.1` shared between Windows and WSL):

```
# In C:\Users\Dale\.wslconfig:
[wsl2]
networkingMode=mirrored
```

Then restart WSL. After that, `127.0.0.1:4255` from WSL reaches Windows directly.

**Caution:** This changes networking for ALL WSL processes including 9router (:20128) and HermesClaw (:9119). Ask Dale before enabling — it may affect other spheres.

### Option C — Defer

Use USCut only from the Windows side (ClaudeClaw / Mick) for now. Omobono integration pending Dale's networking decision.

---

## How to Call the Agent Bridge

Once networking is resolved, here's how to hit the API:

### Read the discovery file (from Windows or via WSL mount)
```bash
# From WSL, Windows AppData is mounted at:
cat "/mnt/c/Users/Dale/AppData/Roaming/aicuts/aicut-bridge.json"
```

### Liveness check
```bash
TOKEN="<from discovery file>"
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4255/api/aicut/info
# → {"service":"aicut","version":"0.1","capabilities":["probe","thumbnail","auto-edit","captions","export"]}
```

### Probe a video
```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filePath":"C:\\Users\\Dale\\Videos\\clip.mp4"}' \
  http://127.0.0.1:4255/api/aicut/probe
```

### AI Auto-Edit
```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Keep only the best 30 seconds, remove silences",
    "clips": [
      {"id":"1","name":"clip.mp4","duration":120,"src":"C:\\Users\\Dale\\Videos\\clip.mp4"}
    ]
  }' \
  http://127.0.0.1:4255/api/aicut/auto-edit
```

### Headless Export
```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clips": [{"id":"1","src":"C:\\path\\to\\clip.mp4","startTime":0,"trimStart":0,"trimEnd":30,"duration":30,"type":"video"}],
    "outputPath": "C:\\Users\\Dale\\Videos\\output.mp4",
    "resolution": "1080p",
    "fps": 30,
    "format": "mp4"
  }' \
  http://127.0.0.1:4255/api/aicut/export
```

### Publish a Social Post (via Social Hub API)
```bash
# First get the Social Hub port from api-port.json
PORT=$(cat "/mnt/c/Users/Dale/AppData/Roaming/aicuts/api-port.json" | python3 -c "import sys,json; print(json.load(sys.stdin)['port'])")

curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountIds": ["<account-uuid>"],
    "pubType": "IMAGE_TEXT",
    "body": "Check out this listing! #realestate",
    "hashtags": ["realestate","homebuying"],
    "mediaRefs": ["https://example.com/image.jpg"]
  }' \
  http://127.0.0.1:$PORT/api/publish
```

---

## Social Account Status

Accounts are connected via webview sessions (user logs in once in the app, cookies persisted by Electron). To check which platforms are connected, use the IPC layer from within Electron or read session cookies from:

```
%APPDATA%\aicuts\  ← Electron userData directory
```

No developer OAuth app is required for basic posting — USCut uses browser session cookies.

---

## Sphere Boundary Note

USCut is Dale's sphere. Do not modify:
- Any files under `C:\home\dalebrown138\projects\Social-Engine-USCut\` without explicit per-task approval
- The bridge port (4255) is USCut's assigned port — do not bind to it from other agents
- The Social Hub loopback port (random, check api-port.json) — same rule

Reading files and hitting the API is fine. Writing/killing/restarting requires approval.

---

## Open Items Needing Dale's Decision

1. **Networking approach** — Option A (WSL proxy + rebind to 0.0.0.0), B (mirrored networking), or C (defer). Dale hasn't chosen.
2. **MCP registration** — Once networking is resolved, the MCP wrapper at `scripts/omobono-electron-smoke.cjs` needs to be registered in your Hermes profile. That's a cross-sphere write requiring Dale's per-task approval.

---

## Who to Ask

- **Dale** — all approvals, networking decision, port assignments
- **Mick (ClaudeClaw)** — built this, has full context, can answer questions about the codebase
- **GitHub** — https://github.com/signal1project/AIcut for latest source
