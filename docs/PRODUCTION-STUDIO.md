# Production Studio

The Studio tab connects a creative brief and supplied videos/images to a native USCut project. AI storyboards use the configured provider resolver. Users can also add and edit scenes manually without a provider. Each scene selects supplied media, a source offset, duration, headline, and narration script.

Build jobs validate local media and video durations, optionally synthesize Windows SAPI narration, then assemble separate editable visual, headline, and audio tracks. Images extend to fit narration; video scenes fail with an actionable error when insufficient source footage remains. Source video audio is muted only when narration was generated for that scene. No paid footage generation is performed.

Jobs use the existing durable JobManager. Results survive restart; interrupted work does not automatically repeat. Cancellation is cooperative between AI/speech/media stages. Generated speech files are removed if a build fails or is cancelled before completion. Successful files remain referenced by the saved job result. Drafts persist locally; applying an AI storyboard explicitly replaces the draft. Opening a result first saves the existing editor project and creates a fresh project copy, so returning to a job cannot overwrite later editor revisions.

AI planning currently receives filenames, media types/durations, and the user's brief. It does not visually analyze supplied footage. Schema validation rejects unknown assets, duplicate IDs, non-finite timing, empty scene lists, and video ranges beyond source duration. The Studio explains these limits and text-provider usage in its UI.

## Verification (2026-09-07)

- TypeScript and changed-file ESLint pass; production Vite build passes (existing renderer chunk-size warning).
- Full suite: 503 passed / 12 existing skips. Nine Studio tests cover native timeline timing, separate caption/audio tracks, image extension, narration overflow, and invalid storyboard data.
- `node scripts/smoke-stabilization.mjs` passes against the built Electron application with an isolated profile. It builds a real supplied video with local Windows narration, verifies persisted tracks and project copying, then exports both 720p portrait and landscape MP4s through the real export handler. FFprobe verifies dimensions, audio streams, and duration. No social post or paid AI call is made.

## Remaining for the complete product

This is a working supplied-media production path, not completion of the entire AI production roadmap. Generated footage integration and spending controls, visual grounding, targeted AI scene revision, music selection inside Studio, durable cancellable export/caption jobs, versioned production documents, backup/restore, installer/upgrade validation, and controlled live delivery verification remain. Exports currently use the editor's existing export/share workflow.
