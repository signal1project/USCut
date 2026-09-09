import { ipcMain, app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  studioDocSchema,
  createStudioDoc,
  updateStudioDoc,
  restoreStudioDocVersion,
  summarizeStudioDoc,
  type StudioDoc,
} from '../../../commont/studioDoc';
import { validateStudioDraft } from '../../../commont/studio';

const ID = /^[a-zA-Z0-9-]{1,100}$/;
const writes = new Map<string, Promise<unknown>>();

function dir() {
  return path.join(app.getPath('userData'), 'studio-productions');
}
function file(id: string) {
  if (!ID.test(id)) throw new Error('Invalid production id');
  return path.join(dir(), `${id}.json`);
}

async function atomicWrite(target: string, doc: StudioDoc) {
  const content = JSON.stringify(doc, null, 2);
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(temp, content, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (attempt >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes(code))
          throw error;
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

/** Serialize all mutations of one production file. */
function queue<T>(id: string, work: () => Promise<T>): Promise<T> {
  const run = (writes.get(id) ?? Promise.resolve()).then(work, work);
  writes.set(
    id,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

async function readDoc(id: string): Promise<StudioDoc> {
  return studioDocSchema.parse(JSON.parse(await fs.readFile(file(id), 'utf8')));
}

export function registerStudioDocHandlers() {
  ipcMain.handle('aicuts:studio-doc-list', async () => {
    let names: string[];
    try {
      names = await fs.readdir(dir());
    } catch {
      return [];
    }
    const docs = await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map((n) =>
          readDoc(n.slice(0, -5))
            .then(summarizeStudioDoc)
            .catch(() => null),
        ),
    );
    return docs
      .filter((d): d is NonNullable<typeof d> => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  ipcMain.handle('aicuts:studio-doc-get', (_, id: unknown) =>
    readDoc(String(id)),
  );

  ipcMain.handle(
    'aicuts:studio-doc-save',
    async (_, payload: { id?: string; draft: unknown; label?: string }) => {
      const draft = validateStudioDraft(payload?.draft);
      const label = String(payload?.label ?? '').slice(0, 200);
      const now = new Date().toISOString();
      const id = payload?.id && ID.test(payload.id) ? payload.id : randomUUID();
      return queue(id, async () => {
        let doc: StudioDoc;
        try {
          doc = updateStudioDoc(await readDoc(id), draft, label, now);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          doc = createStudioDoc(id, draft, now);
        }
        await atomicWrite(file(id), doc);
        return doc;
      });
    },
  );

  ipcMain.handle(
    'aicuts:studio-doc-restore',
    async (_, payload: { id: string; version: number }) => {
      const id = String(payload?.id);
      const version = Number(payload?.version);
      return queue(id, async () => {
        const doc = restoreStudioDocVersion(
          await readDoc(id),
          version,
          new Date().toISOString(),
        );
        await atomicWrite(file(id), doc);
        return doc;
      });
    },
  );

  ipcMain.handle('aicuts:studio-doc-delete', (_, id: unknown) =>
    queue(String(id), () =>
      fs.rm(file(String(id)), { force: true }).then(() => ({ ok: true })),
    ),
  );
}
