import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';

const decision = (id: string, startTime = 0) => ({
  clipId: id,
  startTime,
  trimStart: 1,
  trimEnd: 2,
  reason: 'strong moment',
});
function clip(startTime = 0) {
  return useEditorStore
    .getState()
    .addClipToTrack('track-video-1', {
      src: 'a.mp4',
      name: 'a',
      duration: 10,
      startTime,
      trimStart: 0,
      trimEnd: 0,
      type: 'video',
    });
}
const result = (decisions: ReturnType<typeof decision>[]) => ({
  decisions,
  summary: 'Kept the strongest moments.',
});
beforeEach(() => useEditorStore.getState().resetProject());
describe('atomic AI timeline editing', () => {
  it('removes exclusions, reorders clips, preserves locked tracks, and undoes/redoes the whole edit', () => {
    const a = clip();
    const b = clip(10);
    const c = clip(20);
    const store = useEditorStore.getState();
    const locked = store.addTrack('audio');
    store.addClipToTrack(locked, {
      src: 'music.wav',
      name: 'music',
      duration: 30,
      startTime: 0,
      trimStart: 0,
      trimEnd: 0,
      type: 'audio',
    });
    store.toggleTrackLock(locked);
    const before = useEditorStore.getState();
    before.applyAutoEdit(
      result([decision(c), decision(a, 7)]),
      before.tracks,
      before.projectId,
    );
    const after = useEditorStore.getState();
    expect(after.tracks[0].clips.map((c) => c.id)).toEqual([c, a]);
    expect(after.tracks.flatMap((t) => t.clips).some((c) => c.id === b)).toBe(
      false,
    );
    expect(after.tracks.at(-1)).toEqual(before.tracks.at(-1));
    expect(after.past).toHaveLength(before.past.length + 1);
    after.undo();
    expect(useEditorStore.getState().tracks).toEqual(before.tracks);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().tracks).toEqual(after.tracks);
  });
  it('rejects stale results and leaves newer edits intact', () => {
    const a = clip();
    const before = useEditorStore.getState();
    before.moveClip(a, 4);
    const newer = useEditorStore.getState();
    expect(() =>
      newer.applyAutoEdit(
        result([decision(a)]),
        before.tracks,
        before.projectId,
      ),
    ).toThrow('timeline changed');
    expect(useEditorStore.getState()).toBe(newer);
  });
  it('rejects invalid, duplicate, or empty decisions atomically', () => {
    const a = clip();
    const before = useEditorStore.getState();
    for (const decisions of [
      [],
      [decision('missing')],
      [decision(a), decision(a)],
      [{ ...decision(a), trimEnd: 10 }],
    ]) {
      expect(() =>
        before.applyAutoEdit(
          result(decisions),
          before.tracks,
          before.projectId,
        ),
      ).toThrow();
      expect(useEditorStore.getState()).toBe(before);
    }
  });
});
