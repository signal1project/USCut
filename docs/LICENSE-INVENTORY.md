# USCut — third-party license inventory

Bundled runtime components and their licenses, for a **commercial closed-source**
release. Anything marked ⚠️ needs a decision or action before public sale.

_Last reviewed: 2026-09-09. Re-run when dependencies change._

## Blocking / needs a decision

| Component | Version | License | Issue | Options |
|---|---|---|---|---|
| ⚠️ **`ffmpeg-static`** (bundled `ffmpeg.exe`) | 5.x | **GPL-3.0-or-later** | This is a **GPL** FFmpeg build (x264/x265 etc.). USCut ships it in the installer and calls it as a child process. FFmpeg runs as a *separate executable* (not linked), which is the usual basis for "mere aggregation," but shipping a GPL binary in a proprietary installer still requires full GPL compliance for that binary (written offer of source, unmodified license text, no additional restrictions) and the aggregation argument is not universally accepted. | (a) switch to a modern **LGPL** FFmpeg build (BtbN LGPL / a maintained LGPL npm package) — LGPL is compatible with proprietary when FFmpeg stays separately replaceable; verify xfade/adelay/colortemperature are present (the 2018 `@ffmpeg-installer` build lacked them). (b) keep GPL FFmpeg, ship its source + a written offer + license text, treat as aggregation — **get counsel to confirm**. (c) require the user to install FFmpeg themselves. **Dale's call.** |
| ⚠️ Repository `LICENSE` / `package.json` `"license": "MIT"` | — | — | The project declares itself MIT. A commercial closed-source product must not ship an MIT grant for the whole app. | Replace with a proprietary EULA; set `package.json` `"license": "UNLICENSED"` or a SEE-LICENSE ref; keep third-party notices separate (this file + a bundled NOTICES). |

## Permissive — bundle with attribution

| Component | License | Notes |
|---|---|---|
| `nodejs-whisper` | MIT | wrapper only |
| **whisper.cpp** (compiled `whisper-cli.exe`, via nodejs-whisper) | MIT | ggerganov/whisper.cpp |
| **`ggml-base.en.bin`** Whisper model | MIT | OpenAI Whisper weights, MIT-licensed; from the official ggerganov HF repo |
| `onnxruntime-node` / `onnxruntime-common` | MIT | pulled in by kokoro-js |
| `kokoro-js` | Apache-2.0 | local neural narration; include NOTICE |
| **Kokoro-82M** model (downloaded on first use, ~89 MB) | Apache-2.0 | `hexgrad/Kokoro-82M`; not bundled in the installer — fetched at runtime |
| `@huggingface/transformers` | Apache-2.0 | include NOTICE |
| `sharp` / `@img/*` | Apache-2.0 | image processing |
| `better-sqlite3` | MIT | native, rebuilt for the Electron ABI |
| `@ffprobe-installer/ffprobe` | (verify) | ffprobe binary — **check whether this build is also GPL**; same question as ffmpeg-static |
| Electron / Chromium / Node | MIT / BSD / MIT | standard Electron redistribution; include Chromium's `LICENSES` in the app |
| React, Zustand, Vite, TailwindCSS, TypeORM, Radix/shadcn UI, lucide-react, sonner, zod | MIT | standard |

## Fonts (bundled in `public/assets/fonts/`)

| Font | License | Commercial bundling |
|---|---|---|
| Montserrat-Bold | SIL Open Font License 1.1 | ✅ permitted — ship `OFL.txt` alongside |
| PlayfairDisplay-Bold | SIL Open Font License 1.1 | ✅ permitted — ship `OFL.txt` alongside |

**Action:** add the OFL license text for both families to a bundled `NOTICES/`
folder (currently the `.ttf` files ship without their license).

## Actions before release

1. **Resolve the FFmpeg license question** (row 1) — Dale decides; if switching
   builds, re-run the full ffmpeg e2e suite (xfade / acrossfade / adelay / ASS
   burn-in / zoompan all exercised by `videoService.*.e2e.test.ts`).
2. Replace the MIT `LICENSE` with a proprietary EULA; fix `package.json`.
3. Create a bundled `NOTICES/` (or in-app "Third-party licenses" screen) with:
   whisper.cpp MIT, Kokoro/transformers/onnxruntime Apache NOTICE files, the two
   OFL font licenses, Chromium `LICENSES`, and — if kept — the FFmpeg GPL text +
   written offer of source.
4. Confirm `@ffprobe-installer/ffprobe`'s build license.
5. Verify no `devDependencies` leak into the packaged app (electron-builder
   bundles `dependencies` + `optionalDependencies` only — spot-check the asar).
