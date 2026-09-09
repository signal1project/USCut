# Windows release verification

Build with `npx tsc --noEmit`, `npx vite build`, and `npx electron-builder --win nsis --publish never`. Publishing is a separate release action. A successful builder log mentioning signtool does not prove that the executable is signed: inspect its Authenticode signature separately. The first September 9 build was unsigned.

`scripts/verify-packaged-runtime.cjs` is an afterPack gate for Windows. It requires the bundled Whisper executable and base.en model in the unpacked resources, starts Whisper and the bundled modern FFmpeg, and fails packaging if they are unavailable. The package explicitly unpacks nodejs-whisper so executables, dependent libraries and model files have real filesystem paths.

Local transcription now executes that bundled CLI directly with argument arrays and hidden windows. It does not invoke nodejs-whisper's compiler/downloader wrapper or require CMake/MSVC on the customer machine. Its output is parsed into the existing segment/word format, temporary output is removed, and Auto-Clip can cancel the transcription process. Conversion to WAV still completes before the transcription cancellation checkpoint.

Run the full smoke test against the executable:

```powershell
node scripts/smoke-stabilization.mjs release/0.1.0/win-unpacked/USCut.exe
```

The harness sets `USCUT_PROFILE_DIR` to a unique temporary test profile, verifies `app.isPackaged` and the actual profile path, and limits the app's PATH to Windows system directories. It exercises the shipped app's database, protected settings, local transcription of real narration, Studio, real video exports, and project recovery. It does not open the customer's normal profile. The explicit `USCUT_PROFILE_DIR` override must be absolute and is applied before stores/databases are initialized; absent this variable, normal profile behavior is unchanged.

This packaged-executable test is distinct from an installer wizard test and a clean Windows machine/VM acceptance test. Those, signed-update verification, commercial billing/activation, and a final release audit are still required before public distribution. Test artifacts under `release/` are not customer-ready releases simply because packaging succeeds.
