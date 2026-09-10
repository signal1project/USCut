import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Single-process store. Deploy one writer on a persistent volume; clustered
// deployments require a transactional database instead of sharing this file.
export async function openStore(filename) {
  let state = { version: 1, entitlements: {}, events: {} };
  try {
    state = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (state.version !== 1 || !state.entitlements || !state.events)
      throw new Error('Invalid licensing store');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let tail = Promise.resolve();
  return {
    get(email) {
      return Object.hasOwn(state.entitlements, email)
        ? structuredClone(state.entitlements[email])
        : undefined;
    },
    get size() {
      return Object.keys(state.entitlements).length;
    },
    apply(eventId, mutate) {
      const operation = tail.then(async () => {
        if (Object.hasOwn(state.events, eventId)) return false;
        const next = structuredClone(state);
        await mutate({
          set(email, value) {
            Object.defineProperty(next.entitlements, email, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
          delete(email) {
            delete next.entitlements[email];
          },
          deleteCustomer(customer) {
            for (const [email, record] of Object.entries(next.entitlements))
              if (record.customer === customer) delete next.entitlements[email];
          },
        });
        Object.defineProperty(next.events, eventId, {
          value: Date.now(),
          enumerable: true,
        });
        await fs.mkdir(path.dirname(filename), { recursive: true });
        const pending = `${filename}.${randomUUID()}.tmp`;
        try {
          const handle = await fs.open(pending, 'wx', 0o600);
          try {
            await handle.writeFile(JSON.stringify(next));
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(pending, filename);
          state = next;
        } finally {
          await fs.rm(pending, { force: true });
        }
        return true;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
