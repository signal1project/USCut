# USCut — third-party license inventory

Bundled runtime components and their licenses, for a **commercial closed-source**
release. Anything marked ⚠️ needs a decision or action before public sale.

_Last reviewed: 2026-09-16. Re-run when dependencies change._

## Resolved 2026-09-16

**FFmpeg GPL-3.0 issue — fixed.** Replaced `ffmpeg-static` (GPL-3.0, bundled
libx264/libx265) with a vendored **LGPL-3.0** build (BtbN/FFmpeg-Builds
`win64-lgpl-shared`, `--disable-libx264 --disable-libx265 --enable-version3`)
at `resources/ffmpeg/win-x64/` — no counsel needed, no source-offer obligation,
just LICENSE.txt attribution (bundled alongside the binaries). Also dropped
`@ffmpeg-installer/ffmpeg`, `ffprobe-static`, `@ffprobe-installer/ffprobe`
(all now dead weight — see `electron/util/ffmpegBinary.ts`).

Since libx264 itself is GPL (no LGPL build of it exists), video encoding
switched from `libx264` to **`h264_mf`** (Windows Media Foundation — an OS
API call, ships zero encoder code) across all 4 encode call sites
(`ffmpegOps.ts`, `previewProxy.ts`, `clipService.ts`, `videoService.ts`).
Windows-only; if USCut ever ships Mac/Linux, each platform needs its own
encoder path (VideoToolbox on Mac, OpenH264 as a Linux/universal fallback —
no single encoder is both license-clean and top quality on every OS).

Filter-compatibility audit against the LGPL build found one more GPL-only
filter in production use: **`eq`** (brightness/contrast/saturation). Replaced
with `lutyuv` (brightness/contrast, luma-only) + `hue`'s `s=` parameter
(saturation, chroma-only) — same per-plane split `eq` uses internally, so the
visual result matches. Every other filter USCut uses (`xfade`, `acrossfade`,
`adelay`, `colortemperature`, `ass`, `zoompan`, `gblur`, `unsharp`, `overlay`,
etc.) was cross-checked against the LGPL build's `-filters` output and is
present.

Also patched a real upstream bug this surfaced: `fluent-ffmpeg` (unmaintained
since ~2020) parses `ffmpeg -formats` with a regex that doesn't understand
the "is a device" column FFmpeg added to that output — broke specifically on
`lavfi` (used throughout for solid-color/silence generator inputs). Fixed via
`patch-package` (`patches/fluent-ffmpeg+2.1.3.patch`), applied automatically
on `npm install` via the `postinstall` script.

Full test suite (553 passed / 12 skipped), `tsc`, eslint, vite build, the
full stabilization smoke test, and the packaged-build `afterPack` gate (which
now does a real `h264_mf` one-frame encode, not just `-version`) all verified
green against the new binary.

**Code-signing cert — investigated, real finding (corrects the prior
assumption):** checked the actual built files with `Get-AuthenticodeSignature`
rather than trusting the build log's "signing with signtool.exe" lines —
every packaged file comes back `NotSigned`. Both certificate stores
(`Cert:\CurrentUser\My`, `Cert:\LocalMachine\My`) have zero code-signing
certificates, real or self-signed. electron-builder's auto-sign step finds no
usable cert and silently no-ops instead of failing the build. Today's
installer triggers Windows SmartScreen's full "Unknown Publisher" warning for
every downloader. **On hold per Dale** — needs a real CA-issued cert (OV or
EV), which requires the same business-identity verification as the Stripe/
seller-entity item below.

**Proprietary LICENSE + NOTICES bundle — done 2026-09-16.** Root `LICENSE`
replaced with a proprietary EULA (license grant, subscription/billing terms,
content ownership, third-party component reference, warranty disclaimer,
liability cap, termination, governing-law placeholder). `package.json`
`"license"` changed from `"MIT"` to `"SEE LICENSE IN LICENSE"`. New
`NOTICES/` folder (`README.md` index + `MIT.txt` + `APACHE-2.0.txt`) covers
every permissive dependency; the FFmpeg LGPL text and the two fonts' OFL
texts were already bundled from earlier work, just referenced from the new
index rather than duplicated. Electron's own packaging already auto-bundles
`LICENSE.electron.txt` + `LICENSES.chromium.html` — confirmed present in the
`win-unpacked` output, so that action item needed no work at all. `NOTICES/`
and `LICENSE` both added to `electron-builder.json` `extraResources` so they
ship in the installer. **This is a drafted EULA, not attorney-reviewed** —
in particular the subscription auto-renewal language should get a real
lawyer's pass before Dale takes paying customers' money, since auto-renewal
disclosure requirements vary by US state.

## Blocking / needs a decision

*(none remaining in this file — the two outstanding items above, code-signing
cert and EULA attorney review, are tracked here as notes, not open license
questions.)*

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
| **FFmpeg / FFprobe** (`resources/ffmpeg/win-x64/`) | LGPL-3.0-or-later | BtbN/FFmpeg-Builds `win64-lgpl-shared`; bundled `LICENSE.txt` ships alongside the binaries |
| Electron / Chromium / Node | MIT / BSD / MIT | standard Electron redistribution; include Chromium's `LICENSES` in the app |
| React, Zustand, Vite, TailwindCSS, TypeORM, Radix/shadcn UI, lucide-react, sonner, zod | MIT | standard |

## Fonts (bundled in `public/assets/fonts/`)

| Font | License | Commercial bundling |
|---|---|---|
| Montserrat-Bold | SIL Open Font License 1.1 | ✅ permitted — ship `OFL.txt` alongside |
| PlayfairDisplay-Bold | SIL Open Font License 1.1 | ✅ permitted — ship `OFL.txt` alongside |

**Action:** ✅ already done before this session — `OFL.txt` ships alongside
each `.ttf` in `public/assets/fonts/`, packaged via the existing
`extraResources` entry to `resources/assets/fonts/`. Referenced (not
duplicated) from the new `NOTICES/README.md` index.

## Actions before release

1. ~~Resolve the FFmpeg license question~~ ✅ done 2026-09-16 (see above).
2. ~~Replace the MIT `LICENSE` with a proprietary EULA; fix `package.json`~~
   ✅ done 2026-09-16 (see above) — pending attorney review.
3. ~~Create a bundled `NOTICES/`~~ ✅ done 2026-09-16 (see above).
4. Verify no `devDependencies` leak into the packaged app (electron-builder
   bundles `dependencies` + `optionalDependencies` only — spot-check the asar).

## Packaging bloat / hygiene (found in the 2026-09-09 `--publish never` build)

The installer was ~513 MB. Trim before release:

- `asarUnpack: **/node_modules/nodejs-whisper/**/*` ships the **entire**
  whisper.cpp `build/` tree — ~20 extra executables (`whisper-server.exe`,
  `whisper-bench.exe`, `parakeet-*.exe`, `test-*.exe`, `bench.exe`, `main.exe`,
  CMake compiler-probe exes). Only `build/bin/Release/whisper-cli.exe` and
  `models/ggml-base.en.bin` are used. Add `files` negations to drop the rest.
- ~~Two FFmpeg binaries + three ffprobe binaries~~ ✅ resolved 2026-09-16 —
  now a single vendored LGPL ffmpeg.exe/ffprobe.exe pair at
  `resources/ffmpeg/win-x64/` (~154 MB incl. shared DLLs), replacing 4 old
  npm packages (`ffmpeg-static`, `@ffmpeg-installer/ffmpeg`, `ffprobe-static`,
  `@ffprobe-installer/ffprobe`).
- The build **signed** every exe with `signtool.exe` — confirm which certificate
  was used (a real publisher cert vs a self-signed/dev cert in the store).
