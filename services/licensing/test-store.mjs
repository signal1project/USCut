import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';

test('persists events and entitlements atomically across reopen and concurrent retries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uscut-store-'));
  try {
    const file = path.join(dir, 'store.json');
    const store = await openStore(file);
    let calls = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        store.apply('evt_1', (tx) => {
          calls++;
          tx.set('buyer@example.com', { token: 'test' });
        }),
      ),
    );
    assert.equal(calls, 1);
    const reopened = await openStore(file);
    assert.equal(reopened.get('buyer@example.com').token, 'test');
    assert.equal(
      await reopened.apply('evt_1', () => {
        throw new Error('must not replay');
      }),
      false,
    );
    await assert.rejects(
      reopened.apply('evt_fail', (tx) => {
        tx.delete('buyer@example.com');
        throw new Error('interrupted');
      }),
    );
    assert.equal(reopened.size, 1);
    assert.equal(
      await reopened.apply('evt_fail', (tx) => tx.delete('buyer@example.com')),
      true,
    );
    assert.equal((await openStore(file)).size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
