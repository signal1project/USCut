import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  useEditorStore,
  type ProjectSnapshot,
  type MediaItem,
} from '../store/editorStore';
import { ipc, hasIpc } from './ipc';

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: string;
  clipCount: number;
  mediaCount: number;
}

/** Persist the current editor state. Silent — no dialogs. */
let saveAttempt = 0;
export async function saveCurrentProject(): Promise<boolean> {
  if (!hasIpc()) return false;
  const attempt = ++saveAttempt;
  const { snapshotProject, setSaveState } = useEditorStore.getState();
  const snapshot = snapshotProject();
  setSaveState('saving');
  try {
    const result = (await ipc.invoke('aicuts:project-save', snapshot)) as
      | { success?: boolean; savedAt?: string }
      | undefined;
    const current = useEditorStore.getState();
    if (attempt !== saveAttempt || current.projectId !== snapshot.id)
      return false;
    const unchanged =
      current.tracks === snapshot.tracks &&
      current.mediaLibrary === snapshot.mediaLibrary &&
      current.projectName === snapshot.name &&
      current.zoom === snapshot.zoom;
    if (result?.success && unchanged) {
      setSaveState('saved', result.savedAt);
      return true;
    }
    setSaveState('dirty');
    return false;
  } catch {
    if (
      attempt === saveAttempt &&
      useEditorStore.getState().projectId === snapshot.id
    )
      setSaveState('dirty');
    return false;
  }
}

/**
 * Save the current editor content as a NEW project under `name`. The
 * previously saved project remains on disk; the editor switches to the copy.
 */
export async function saveProjectAs(name: string): Promise<boolean> {
  if (!hasIpc()) return false;
  useEditorStore.getState().forkProjectAs(name);
  return saveCurrentProject();
}

export async function listProjects(): Promise<ProjectMeta[]> {
  if (!hasIpc()) return [];
  const result = (await ipc.invoke('aicuts:project-list')) as
    | ProjectMeta[]
    | undefined;
  return Array.isArray(result) ? result : [];
}

export async function deleteProject(id: string): Promise<void> {
  await ipc.invoke('aicuts:project-delete', id);
}

/** Load a project into the editor store. Returns missing media paths (if any). */
export async function openProject(
  id: string,
): Promise<{ ok: boolean; missing: string[]; error?: string }> {
  const result = (await ipc.invoke('aicuts:project-load', id)) as
    | {
        project?: ProjectSnapshot & { savedAt?: string };
        missing?: string[];
        error?: string;
        recovered?: boolean;
      }
    | undefined;
  if (!result?.project) {
    return {
      ok: false,
      missing: [],
      error: result?.error ?? 'Project could not be loaded',
    };
  }
  const missing = result.missing ?? [];
  const snapshot = result.project;
  if (missing.length > 0) {
    const missingSet = new Set(missing);
    snapshot.mediaLibrary = (snapshot.mediaLibrary ?? []).map((m: MediaItem) =>
      missingSet.has(m.src) ? { ...m, missing: true } : m,
    );
  }
  useEditorStore.getState().hydrateProject(snapshot);
  if (result.recovered)
    toast.warning(
      'Recovered the previous saved version because the latest project file could not be read. Review it and save to keep this recovery.',
    );
  return { ok: true, missing };
}

/**
 * Debounced autosave: any store mutation that marks the project dirty is
 * written to disk ~1.5s after the last change. Mount once in the editor.
 */
export function useAutosave(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasIpc()) return;

    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      // Only content changes (immer gives new refs) — never playhead ticks.
      const contentChanged =
        state.tracks !== prev.tracks ||
        state.mediaLibrary !== prev.mediaLibrary ||
        state.projectName !== prev.projectName;
      if (!contentChanged || state.saveState !== 'dirty') return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (useEditorStore.getState().saveState === 'dirty')
          void saveCurrentProject();
      }, 1500);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      // Flush pending changes when leaving the editor.
      if (useEditorStore.getState().saveState === 'dirty')
        void saveCurrentProject();
    };
  }, []);
}
