# USCut — dependency security assessment (2026-09-09)

`npm audit --omit=dev`: **39 → 11 → 9** findings (**6 high, 3 moderate,
0 critical**). The 11 → 9 step this round removed two **unused direct
dependencies** (`image-size`, `echarts`) — verified not imported anywhere in
`src/`, `electron/`, `packages/`, or `scripts/`; full suite + build + packaged
smoke stayed green.

Raw counts don't establish exploitability. This is a per-finding reachability
assessment for a **single-user Windows-only desktop app** (Electron, no server,
no SSR, no multi-tenant surface). None block the *build*. The runtime items
(`sharp`/libvips, `electron`) should be tracked; everything else is build-time
or not reachable.

## Fixed this round

- **`image-size`** (HIGH — ICNS/JXL/HEIF parser DoS) — removed, unused.
- **`echarts`** (MODERATE — XSS) — removed, unused.

## Findings

### `sharp` ≤ 0.35.4-rc.0 + `@huggingface/transformers` + `kokoro-js` — HIGH, no fix available
libvips CVE-2026-33327/33328/35590/35591 and libheif GHSA-g89c-p67h-r497 /
GHSA-2jg2-4ch7-h545 — memory-safety / DoS in image decoders.

- **Where:** `sharp` is used for image processing; `kokoro-js → transformers →
  sharp` for the local neural narration model download/prep.
- **Reachable with untrusted input?** Partially. The user's own imported footage
  is not attacker-controlled in the normal case. Real vectors: (a) images inside
  a `.uscut.zip` restored from someone else — the ZIP *structure* is now
  validated (`f5d9f26`) but the media bytes are still decoded; (b) a tampered
  Kokoro model fetched over the network.
- **Impact if hit:** crash / hang / potential memory corruption in the render or
  model-prep process — not privilege escalation, no persistence.
- **Action:** track `sharp`/`libvips`/`libheif` for the upstream fix; bump as
  soon as one lands and re-run the ffmpeg + reel e2e suite. Interim: the model
  download should pin a hash (already noted in `LICENSE-INVENTORY.md`); consider
  gating restore of a third-party `.uscut.zip` behind a warning.

### `electron` 33.4.11 — HIGH
ASAR Integrity Bypass via resource modification; AppleScript injection in
`app.moveToApplicationsFolder` (**macOS only — USCut is Windows-only**); a
service-worker issue.

- **Reachable?** The macOS item does not apply. The ASAR integrity bypass
  requires an attacker who can already write to the installed app's files on
  the user's machine — a "local write already achieved" scenario, not remote.
- **Action:** the fix is an **Electron major upgrade** (33 → current). That is a
  focused migration on its own — native-module ABI rebuild (`better-sqlite3`,
  `onnxruntime-node`), Electron API changes, and a full re-test/re-smoke. Track
  as a scoped task; not a quick hotfix. Added to the release-candidate gate.

### `extract-zip` — HIGH · `esbuild` / `vite` — MODERATE/HIGH — build-time only
`extract-zip` (symlink traversal / arbitrary file write) is `@electron/get`'s
transitive, used to unpack the Electron binary **during `npm install`**. The
shipped app never calls it. `esbuild`/`vite` findings are the dev server.
- **Action:** sweep with the other dev-tool findings before release; none ship
  to customers.

### `react-router` / `react-router-dom` 6.0.0–7.17.0 — MODERATE
GHSA-wrjc-x8rr-h8h6 (open redirect via backslash in `<Link>` / `useNavigate`) and
GHSA-337j-9hxr-rhxg (constructor injection via `deserializeErrors()` in **SSR
hydration**).

- **Reachable?** **No.**
  - SSR hydration: USCut has no SSR — it's a static hash-routed SPA inside
    Electron. The `deserializeErrors()` path never runs.
  - Open redirect: every `to=` / `navigate()` target in the app is a static
    literal route (`/editor`, `/mas/studio`, …). There is no user-controlled
    navigation destination.
- **Action:** do **not** force `npm audit fix --force` — it performs the v6 → v7
  breaking upgrade across the whole router. Track as a planned v7 migration
  (its own scoped task), not a security hotfix. Documented as not-reachable here.

## Development-tool findings

`npm audit` (with dev deps) still reports criticals in build tooling
(vite/rollup plugin chain, chart libs, etc.). These run only on the build
machine, never ship to customers, and are lower priority than the runtime
items above — but should be swept before release with per-package
compatibility checks (not `--force`).

## Bottom line

- **Done:** removed unused `image-size` + `echarts` (2 findings gone, one high).
- **Track for a wide launch (runtime):**
  - `sharp`/libvips/libheif chain — wait for upstream, then bump + re-run the
    ffmpeg/reel e2e suite.
  - `electron` 33 → current — a scoped upgrade task (ABI rebuild + full re-test).
- **Not reachable:** `react-router` (no SSR, no user-controlled nav) — the v7
  upgrade is normal maintenance, not a hotfix.
- **Build-time only, not shipped:** `extract-zip`, `esbuild`, `vite` — sweep
  before release with per-package compatibility checks (not `--force`).
