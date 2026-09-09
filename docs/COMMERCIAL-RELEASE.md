# USCut commercial release gates

Owner direction: USCut, subscription based (2026-09-09). The complete AI video production scope remains active. Passing a subset of tests does not authorize representing the entire product as finished.

| Requirement | Current evidence / required proof | Status |
| --- | --- | --- |
| Native editable production | Studio supplied-media storyboard, local narration, separate tracks; real Electron smoke builds and exports portrait/landscape | Implemented; broader customer footage coverage required |
| Reliable exports | Background jobs, cancellation, temporary-file commit; real FFmpeg cancellation test; real Electron queued export and saved results verified | Implemented; crash/installer coverage remains |
| Full AI workflow | Provider resolver, AI storyboard generation, frame-grounded planning (vision-capable providers), single-scene AI revision | Generated footage + usage/spending controls, in-Studio music, durable caption/share jobs, versioned production docs remain |
| Subscription checkout and access | No subscription service or entitlement verification found | Required: hosted checkout, verified webhooks, activation, refresh/revocation, offline policy, billing management, test-mode lifecycle tests |
| Project recovery | Serialized writes, previous valid save, corrupt-primary fallback; stale renderer save completions cannot mark newer edits saved | Implemented for project metadata; portable media backup/restore remains |
| Database upgrades | Explicit additive baseline migration; verified online SQLite backup; transactional upgrades; old/synchronized-profile and rollback tests under Electron ABI | Implemented and real-app startup verified; customer restore UI remains |
| Customer installation | NSIS configuration and previous packaged-app smoke | Required: fresh package, clean machine install/update/uninstall tests, bundled native engines/models verification |
| Release authenticity | GitHub updater configured | Required: signing credentials, signed installer/update validation, controlled release publication |
| Live workflows | Existing social adapters and Zillow pipeline | Required: controlled real capture and supported delivery checks; assisted posting remains a human final action |
| Customer documentation | Technical docs and diagnostics exist | Required: onboarding, supported feature matrix, troubleshooting, support contact, release notes |
| Distribution rights | Repository currently declares MIT | Required: ownership and dependency/font/model/media inventory; preserve third-party notices and obtain release review |
| Billing/support business details | Product name USCut; subscription selected | Price/currency, payment account, support email, seller details remain to be supplied |

## Working order

1. Verify and push export reliability.
2. Protect customer projects and validate installer/runtime dependencies.
3. Implement subscription service and activation against a test payment environment, then connect the owner's account and chosen prices.
4. Complete the AI production workflow and usage controls.
5. Run an end-to-end release candidate audit on installation, paid access, production, export, recovery, upgrades, and supported delivery. Record specific evidence and unresolved limitations.
6. Prepare the signed distribution and customer materials. Publish only after release gates are satisfied.

No production payment, social post, signing purchase, or release publication has been performed by this checklist.
