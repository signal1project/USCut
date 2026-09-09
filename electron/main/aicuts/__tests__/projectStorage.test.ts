import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveProjectFile, readProjectFile } from '../projectStorage';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function location() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uscut-project-test-'));
  directories.push(dir);
  return path.join(dir, 'project.json');
}
const project = {
  version: 1 as const,
  id: 'project',
  name: 'Original',
  savedAt: new Date().toISOString(),
  tracks: [],
  mediaLibrary: [],
};
it('serializes overlapping saves and retains the previous valid save', async () => {
  const file = await location();
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      saveProjectFile(file, { ...project, name: `Save ${i}` }),
    ),
  );
  expect((await readProjectFile(file)).project.name).toBe('Save 9');
  expect(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).name).toBe(
    'Save 8',
  );
  expect((await fs.readdir(path.dirname(file))).sort()).toEqual([
    'project.json',
    'project.json.bak',
  ]);
});
it('recovers the previous valid file after primary corruption and preserves it on the next save', async () => {
  const file = await location();
  await saveProjectFile(file, project);
  await saveProjectFile(file, { ...project, name: 'Latest' });
  await fs.writeFile(file, '{truncated');
  const recovered = await readProjectFile(file);
  expect(recovered.recovered).toBe(true);
  expect(recovered.project.name).toBe('Original');
  await saveProjectFile(file, { ...project, name: 'Restored' });
  expect((await readProjectFile(file)).recovered).toBe(false);
  expect(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).name).toBe(
    'Original',
  );
});
it('does not disguise a project with no valid recovery as a successful load', async () => {
  const file = await location();
  await fs.writeFile(file, '{}');
  await expect(readProjectFile(file)).rejects.toThrow('Invalid project file');
});
