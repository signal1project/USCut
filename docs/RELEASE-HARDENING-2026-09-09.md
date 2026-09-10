# Release hardening checkpoint

This checkpoint is not release approval. USCut still needs complete subscription
handling, remaining security remediation, generated-video integration, signing,
and clean-machine/customer-workflow validation.

## Implemented

- Backup paths are passed as literal PowerShell strings. ZIP creation writes a
  same-directory temporary archive and replaces the destination only on success.
- Media copy errors other than missing files abort backup creation.
- Restore checks archive entry names, duplicates, entry count (10,000), total
  expanded size (100 GiB), and metadata size (16 MiB) before extraction. Failed
  restores remove their newly created media folder.
- Stripe webhooks use the official SDK to verify raw-body signatures with a
  five-minute tolerance; HTTP bodies are capped at 1 MiB. This does not implement
  durable event deduplication or authenticated activation.
- Removed unused `build` dependency and applied compatible dependency fixes.
- Corrected licensing service documentation that previously described an
  authentication/refresh flow that did not exist.

## Verified against these changes

- TypeScript: no diagnostics.
- Application tests: 551 passed, 12 skipped.
- Licensing tests: four crypto lifecycle scenarios and five webhook checks pass.
- Native Electron database upgrade harness: four scenarios pass, including WAL
  backup preservation and migration rollback.
- Vite production build: renderer, main process, and preload builds pass.
- Production audit: 11 findings (7 high, 4 moderate, 0 critical), down from 39.
  Full development-tool audit still has critical findings. Audit counts do not
  establish exploitability or release safety.

## Still required

- Test malicious archive fixtures and large real customer projects; happy-path
  round trips alone do not prove every validation boundary.
- Replace email-only activation with authenticated customer access, durable
  storage, verified payment-state reconciliation, replay deduplication, checkout,
  subscription management, refresh/revocation, and product entitlement gates.
- Remediate remaining Electron, image processing, build tooling, routing, and
  chart dependency findings with compatibility checks.
- Rebuild and smoke-test packaged artifacts after dependency changes. Existing
  installer artifacts do not prove the updated code works and remain unsigned.
- Complete generated-footage provider integration and commercial configuration.
- Complete distribution notices, code signing, clean Windows install/upgrade
  tests, and live test-mode billing/provider verification before a sales launch.
