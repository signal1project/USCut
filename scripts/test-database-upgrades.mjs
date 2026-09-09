import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'test-results', 'database-upgrade-tests.cjs');
await build({
  entryPoints: [path.join(root, 'electron/db/__e2e__/upgrade.integration.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: { '@mas/types': path.join(root, 'packages/types/src/index.ts') },
  define: { 'import.meta.url': '__bundleUrl' },
  banner: {
    js: 'const __bundleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});
const result = spawnSync(require('electron'), [outfile], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
