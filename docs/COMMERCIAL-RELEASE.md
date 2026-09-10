# USCut commercial release gates

Owner direction: USCut, subscription based (2026-09-09). The complete AI video production scope remains active. Passing a subset of tests does not authorize representing the entire product as finished.

| Requirement | Current evidence / required proof | Status |
| --- | --- | --- |
| Native editable production | Studio supplied-media storyboard, local narration, separate tracks; real Electron smoke builds and exports portrait/landscape | Implemented; broader customer footage coverage required |
| Reliable exports | Background jobs (toolbar export AND the editor Share flow), cancellation, temporary-file commit, startup GC of crash-orphaned partial renders; real FFmpeg cancellation test; real Electron queued + share renders verified | Implemented; installer coverage remains |
| Full AI workflow | Provider resolver, AI storyboard generation, frame-grounded planning (vision-capable providers), single-scene AI revision | Generated footage + usage/spending controls, one-click caption job remain |
| Subscription checkout and access | Offline-verifiable ed25519 tokens (app verify + strict claim validation + 14-day grace + Settings activate/deactivate); `services/licensing` **implemented** — Stripe SDK webhook verification, live subscription-state reconciliation (price-restricted, never invents paid time), persistent idempotent store, JWKS verified-email `/activate`; full HTTP round-trip test | Blocked on Dale: Stripe account + test keys, deployed private signing key, real identity provider (`AUTH_*`), persistent volume, the checkout + billing-portal UI; app-side **feature gating still not wired** |
| Project recovery | Serialized writes, previous valid save, corrupt-primary fallback; stale renderer save completions cannot mark newer edits saved; portable `.uscut.zip` backup (project + all referenced media) and self-contained restore | Implemented; crash-time job cleanup and signed-update validation remain |
| Database upgrades | Explicit additive baseline migration; verified online SQLite backup; transactional upgrades; old/synchronized-profile and rollback tests under Electron ABI | Implemented and real-app startup verified; customer restore UI remains |
| Customer installation | `--publish never` NSIS build passes incl. the `afterPack` runtime gate (bundled FFmpeg + Whisper + model verified to start); the **packaged** `USCut.exe` passes the full stabilization smoke (DB migrations, local Whisper, Studio, backup/restore, licensing, cleanup) | Clean-machine install/update/uninstall still needs a manual/QA pass (`docs/RELEASE-CANDIDATE-AUDIT.md` §3); installer bloat trim pending (`docs/LICENSE-INVENTORY.md`) |
| Release authenticity | GitHub updater configured; the `--publish never` build auto-signs via `signtool.exe` (cert already in the machine store — unverified whether it is a real publisher cert) | Required: confirm/obtain a real code-signing cert, signed installer + update validation, controlled release publication |
| Dependency security | `npm audit --omit=dev` 39 → 9 (6 high / 3 moderate / 0 critical); unused `image-size` + `echarts` removed; every remaining finding assessed for reachability in `docs/SECURITY-AUDIT-2026-09-09.md` | Track `sharp`/libvips upstream fix; scoped `electron` 33 → current upgrade; sweep build-tool findings |
| Live workflows | Existing social adapters and Zillow pipeline | Required: controlled real capture and supported delivery checks; assisted posting remains a human final action |
| Customer documentation | `docs/ONBOARDING.md`, `docs/FEATURE-MATRIX.md`, technical docs, in-app diagnostics paths | Support email + release notes still to add |
| Distribution rights | `docs/LICENSE-INVENTORY.md` complete | ⚠️ **`ffmpeg-static` is GPL-3.0** — Dale must choose an LGPL build or a compliant-aggregation path; replace the MIT `LICENSE`/`package.json` with a proprietary EULA; bundle a NOTICES set (fonts OFL, Apache NOTICEs, Chromium) |
| Billing/support business details | Product name USCut; subscription selected; licence keypair generated (public key bundled, private key at projects/_secrets/, outside the repo) | Price/currency, Stripe account, support email, seller details, code-signing cert remain to be supplied |

## Working order

1. Verify and push export reliability.
2. Protect customer projects and validate installer/runtime dependencies.
3. Implement subscription service and activation against a test payment environment, then connect the owner's account and chosen prices.
4. Complete the AI production workflow and usage controls.
5. Run an end-to-end release candidate audit on installation, paid access, production, export, recovery, upgrades, and supported delivery. Record specific evidence and unresolved limitations.
6. Prepare the signed distribution and customer materials. Publish only after release gates are satisfied.

No production payment, social post, signing purchase, or release publication has been performed by this checklist.
