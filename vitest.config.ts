import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: [
      'test/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'chrome-extension/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'electron/**/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'electron/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/**/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: [
      ...configDefaults.exclude,
      // Playwright e2e — runs via Playwright against a packaged app, not vitest.
      'test/e2e.spec.ts',
      // Upstream platform specs depending on SDKs we don't ship (@yikart/common,
      // @xdevplatform/xdk). Restored when the US adapters land (Tasks 6–8).
      'electron/main/plat/libs/exception/base.spec.ts',
      'electron/main/plat/libs/twitter/twitter.exception.spec.ts',
    ],
    testTimeout: 1000 * 29,
    environment: 'node',
  },
});
