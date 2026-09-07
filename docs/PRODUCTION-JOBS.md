# Production jobs and readiness

September 7, 2026 checkpoint, following stabilization commit `40e7e4e` (pushed to `origin/main`).

## Auto-Clip jobs

The editor's Find & Cut Clips action now creates a job and returns immediately. Recent jobs show the current stage, approximate progress, cancellation, failure, and completion. Completed clips are added explicitly to the current project's media library. Repeated imports do not duplicate the same media paths. Navigating away from the editor does not stop the backend job.

The job queue runs one queued job at a time, with at most five additional waiting jobs. The older synchronous API remains available for existing clients.

Authenticated endpoints on the MAS loopback API:

- `POST /api/clips/jobs`: the existing Auto-Clip input plus `requestId` (UUID). Returns HTTP 202 and a job. Retrying the same ID and input returns the existing job; reusing an ID with different input fails.
- `GET /api/clips/jobs`: latest 50 records; editor displays the latest 10.
- `GET /api/clips/jobs/:id`: current record and result when completed.
- `POST /api/clips/jobs/:id/cancel`: requests cancellation. Completed/failed jobs are unchanged.
- `POST /api/clips/auto`: existing synchronous endpoint, unchanged for compatibility.

Cancellation stops cloud transcription through its abort signal, prevents subsequent pipeline stages, and terminates the active FFmpeg cutting process. Local Whisper, frame sampling, and AI-provider operations that do not accept cancellation finish their current operation first; the UI says cancellation is waiting. A cancelled job never proceeds to the next stage. Partial cut outputs created by a failed/cancelled invocation are removed.

Records are stored under the app profile's `jobs/auto-clip` directory. Temporary-write/rename persistence retries transient Windows file locks. A newer valid temporary record can be recovered after restart. Queued/running/cancelling jobs found at startup become interrupted; **they do not automatically rerun paid operations**. Completed results remain available. Input transcripts are not saved in job history; rerunning an interrupted job requires a fresh submission. This is result/status recovery, not checkpointed resumption of a half-rendered video.

## Readiness and music

Settings now includes Production readiness. It checks OS credential encryption, selected AI-provider configuration, FFmpeg startup, local Whisper executable/model presence, cloud-transcription key presence, output-directory accessibility, and available standard/luxury music tracks.

Configured means saved configuration or files were found. It does not claim provider connectivity, credit availability, transcription quality, or live social account access. These checks do not call paid APIs or download models.

The music-folder control selects a readable existing folder containing `standard` and `luxury` subfolders. MP3/WAV/M4A/OGG files are supported by the existing selector; each tier uses the first eligible filename alphabetically. An empty setting returns to bundled music. The next listing render reads the current selection, without restarting the app. Missing music retains narration-only behavior.

## Verification and scope

The expanded `node scripts/smoke-stabilization.mjs` launches a built Electron application with its own profile, output directories, generated test media, and fake credentials. It verifies original Auto-Edit stabilization, restart-interrupted history, a real FFmpeg Auto-Clip job through the editor, explicit/deduplicated media import, cancellation through authenticated browser fetch, readiness, and saved music configuration. Screenshots were inspected. User accounts, live schedules, and paid services were not used.

Unit/integration coverage includes queue serialization, duplicate submission, cancellation, failure continuation, restart recovery, locked-file retries, recovery files, and authenticated job routes. A real listing render verifies music selection changed after service creation.

Final checks: TypeScript and Vite builds passed; ESLint on changed application/test files passed; full Vitest suite passed 494 tests with 12 expected Electron-ABI skips. The isolated Electron smoke scenario passed after the Windows persistence fix. The existing renderer bundle-size warning remains.

Remaining: extend jobs to Auto-Edit, captions, listing reels, export and future media-generation services; add checkpointed resumption where safe; finish database migration/backup and installer upgrades; validate live media/provider/account workflows; then connect the brief-to-finished-video production workspace.
