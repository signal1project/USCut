# USCut — third-party notices

USCut is proprietary software (see the `LICENSE` file at the repository root)
that bundles the open-source components listed below. Each remains governed
by its own license; nothing in USCut's own license restricts your rights
under these.

| Component | License | Notes |
|---|---|---|
| FFmpeg / FFprobe | LGPL-3.0-or-later | Text bundled with the binaries at `resources/ffmpeg/win-x64/FFMPEG-LGPL-LICENSE.txt`; BtbN/FFmpeg-Builds `win64-lgpl-shared` |
| nodejs-whisper | MIT | wrapper only — see `MIT.txt` |
| whisper.cpp (`whisper-cli.exe`) | MIT | ggerganov/whisper.cpp — see `MIT.txt` |
| ggml-base.en.bin (Whisper model weights) | MIT | OpenAI Whisper weights, from the official ggerganov Hugging Face repo — see `MIT.txt` |
| onnxruntime-node / onnxruntime-common | MIT | see `MIT.txt` |
| better-sqlite3 | MIT | native, rebuilt for the Electron ABI — see `MIT.txt` |
| React, Zustand, Vite, TailwindCSS, TypeORM, Radix/shadcn UI, lucide-react, sonner, zod | MIT | standard npm dependencies — see `MIT.txt` |
| kokoro-js | Apache-2.0 | local neural narration — see `APACHE-2.0.txt` |
| Kokoro-82M model | Apache-2.0 | `hexgrad/Kokoro-82M`; fetched at runtime, not bundled in the installer — see `APACHE-2.0.txt` |
| @huggingface/transformers | Apache-2.0 | see `APACHE-2.0.txt` |
| sharp / @img/* | Apache-2.0 | image processing — see `APACHE-2.0.txt` |
| Electron / Chromium / Node | MIT / BSD / MIT | bundled automatically by Electron's own packaging as `LICENSE.electron.txt` and `LICENSES.chromium.html` alongside `USCut.exe` |
| Montserrat-Bold, PlayfairDisplay-Bold | SIL Open Font License 1.1 | text ships alongside each font in `public/assets/fonts/*-OFL.txt` (packaged to `resources/assets/fonts/`) |

Full per-component detail and any items still needing a decision live in
`docs/LICENSE-INVENTORY.md`.
