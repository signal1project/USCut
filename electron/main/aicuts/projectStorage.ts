import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ProjectFileV1 } from './projects';

const writes = new Map<string, Promise<void>>();
function parse(raw: string): ProjectFileV1 {
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.tracks) ||
    !Array.isArray(value.mediaLibrary)
  )
    throw new Error('Invalid project file');
  return value;
}
async function replace(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporary, file);
        break;
      } catch (error) {
        if (
          attempt >= 9 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

/** Serialize writes per project, retaining the last valid version before replacing it. */
export function saveProjectFile(
  file: string,
  project: ProjectFileV1,
): Promise<void> {
  const content = JSON.stringify(project, null, 2);
  parse(content);
  const previous = writes.get(file) ?? Promise.resolve();
  const pending = previous.then(async () => {
    let validPrevious: string | undefined;
    try {
      const raw = await fs.readFile(file, 'utf8');
      parse(raw);
      validPrevious = raw;
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !['ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '') &&
        (error as Error).message !== 'Invalid project file'
      )
        throw error;
    }
    if (validPrevious) await replace(file + '.bak', validPrevious);
    await replace(file, content);
  });
  const settled = pending.then(
    () => {},
    () => {},
  );
  writes.set(file, settled);
  void settled.then(() => {
    if (writes.get(file) === settled) writes.delete(file);
  });
  return pending;
}

export async function readProjectFile(
  file: string,
): Promise<{ project: ProjectFileV1; recovered: boolean }> {
  await writes.get(file);
  try {
    return {
      project: parse(await fs.readFile(file, 'utf8')),
      recovered: false,
    };
  } catch (error) {
    try {
      return {
        project: parse(await fs.readFile(file + '.bak', 'utf8')),
        recovered: true,
      };
    } catch {
      throw error;
    }
  }
}
