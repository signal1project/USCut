# USCut stabilization checkpoint — September 7, 2026

## Implemented

- Auto-Edit validates AI response shape, numeric timing, source bounds, unique known clip IDs, and reasons in the backend and renderer. Invalid JSON now produces an error instead of silently rearranging the whole timeline.
- Accepted edits remove omitted clips, sort retained clips by timeline position, and form one undo/redo transaction. Locked tracks remain untouched. Results are rejected if the project or timeline changed during generation. Empty selections preserve the timeline. The UI displays success/error summaries and always releases the busy state.
- API keys, voice keys, authentication tokens, and platform OAuth configurations now use a dedicated OS-encrypted store. Existing plaintext settings migrate only after ciphertext persistence and decryption verification. All three production Settings construction paths use it. Generic renderer storage rejects sensitive paths and ancestors. Failed migration preserves the legacy copy and logs a generic diagnostic.
- Cloud transcription extracts sequential mono 16kHz WAV windows of at most ten minutes, checks upload size, applies request timeouts, carries brief prior context, restores source-relative segment/word timestamps, and removes temporary audio on completion/error. The service accepts progress callbacks and cancellation signals. Auto-Clip, Auto-Edit, and editor cloud captions share this path. No user-facing job cancellation/progress UI is added yet.
- Release/update metadata now targets `signal1project/USCut` instead of the old social-manager repository. Nothing was published.
- Added `scripts/smoke-stabilization.mjs`: reproducible real Electron/renderer test with an isolated profile, ephemeral checked ports, fake credentials, and simulated AI responses.

## Verification

- `npx tsc --noEmit`: passed.
- `npx vite build`: passed; existing large-renderer-chunk warning remains.
- `npx vitest run`: 486 passed / 12 skipped (498 total). Includes real FFmpeg extraction/rendering and Windows SAPI narration; cloud transcription responses are simulated.
- ESLint on changed TypeScript/application files: passed.
- `npm run test:e2e`: passed with real Electron-compatible SQLite and loopback API; external services simulated.
- `node scripts/smoke-stabilization.mjs`: passed actual Electron boot, DPAPI credential migration/decryption, generic IPC secret denial, authenticated browser fetch/CORS, UI edit exclusion/reordering, one-step undo/redo, invalid-result rejection, and project autosave. Screenshot visually inspected.

The desktop smoke test does not call paid providers or real social accounts. It uses an isolated profile under `test-results/stabilization-*`; it does not migrate Dale's live profile. Migration runs when the updated app next starts normally. No installer was built or deployed during this checkpoint.

## Remaining work

1. Test representative footage and paid-provider responses for creative quality, caption accuracy, long-input boundary behavior, and runtime model availability. Fixed audio windows can split sentences; preceding context helps but is not silence-aware splitting.
2. Add user-visible job progress/cancellation/recovery, capability diagnostics, and music-folder selection.
3. Replace schema synchronization with reviewed migrations plus backup/restore and test actual installer upgrades.
4. Verify live Zillow capture, template selection, account/Page/company switching, assisted posting, and local model paths. Preserve the existing final user Post action for Facebook/Instagram/TikTok.
5. Build the unified brief → script → storyboard → assets → editable cut → revisions → exports workflow, followed by media-generation providers and cost controls.

API reference consulted for upload limits and timestamp behavior: https://developers.openai.com/api/docs/guides/speech-to-text
