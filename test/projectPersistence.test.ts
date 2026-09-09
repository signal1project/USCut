import { beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';
import { saveCurrentProject } from '../src/lib/projectPersistence';
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../src/lib/ipc', () => ({ ipc: bridge, hasIpc: () => true }));
beforeEach(() => {
  bridge.invoke.mockReset();
  useEditorStore.getState().forkProjectAs('Original');
});
it('does not mark edits made during a save as saved', async () => {
  let finish!: (value: unknown) => void;
  bridge.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = saveCurrentProject();
  useEditorStore.getState().setProjectName('New edits');
  finish({ success: true });
  expect(await pending).toBe(false);
  expect(useEditorStore.getState().saveState).toBe('dirty');
});
it('does not change a different project after a pending save finishes', async () => {
  let finish!: (value: unknown) => void;
  bridge.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = saveCurrentProject();
  useEditorStore.getState().forkProjectAs('Another project');
  finish({ success: true });
  expect(await pending).toBe(false);
  expect(useEditorStore.getState().saveState).toBe('dirty');
});
it('ignores an older failure when a newer save has completed', async () => {
  let fail!: (reason: unknown) => void;
  bridge.invoke
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValueOnce({ success: true });
  const older = saveCurrentProject();
  expect(await saveCurrentProject()).toBe(true);
  fail(new Error('Old failed write'));
  expect(await older).toBe(false);
  expect(useEditorStore.getState().saveState).toBe('saved');
});
it('keeps edits dirty after an IPC failure', async () => {
  bridge.invoke.mockRejectedValue(new Error('Disk full'));
  expect(await saveCurrentProject()).toBe(false);
  expect(useEditorStore.getState().saveState).toBe('dirty');
});
