import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';

describe('editorStore media library', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it('adds media items and ignores duplicate ids', () => {
    const { addMediaItem } = useEditorStore.getState();
    addMediaItem({ id: 'a', src: '/a.mp4', name: 'a.mp4', duration: 10, type: 'video' });
    addMediaItem({ id: 'a', src: '/a.mp4', name: 'a.mp4', duration: 10, type: 'video' });
    expect(useEditorStore.getState().mediaLibrary).toHaveLength(1);
  });

  it('removes a media item by id — the bug Dale hit: re-importing the same file repeatedly had no way to clean up the duplicates', () => {
    const { addMediaItem, removeMediaItem } = useEditorStore.getState();
    addMediaItem({ id: 'a', src: '/a.mp4', name: 'a.mp4', duration: 10, type: 'video' });
    addMediaItem({ id: 'b', src: '/a.mp4', name: 'a.mp4', duration: 10, type: 'video' });
    expect(useEditorStore.getState().mediaLibrary).toHaveLength(2);

    removeMediaItem('a');
    const library = useEditorStore.getState().mediaLibrary;
    expect(library).toHaveLength(1);
    expect(library[0].id).toBe('b');
  });

  it('removing a media item does not touch clips already placed on the timeline', () => {
    const { addMediaItem, removeMediaItem, addClipToTrack } =
      useEditorStore.getState();
    addMediaItem({ id: 'a', src: '/a.mp4', name: 'a.mp4', duration: 10, type: 'video' });
    const track = useEditorStore.getState().tracks.find((t) => t.type === 'video')!;
    addClipToTrack(track.id, {
      src: '/a.mp4',
      name: 'a.mp4',
      duration: 10,
      startTime: 0,
      trimStart: 0,
      trimEnd: 0,
      type: 'video',
    });

    removeMediaItem('a');
    expect(useEditorStore.getState().mediaLibrary).toHaveLength(0);
    expect(useEditorStore.getState().tracks[0].clips).toHaveLength(1);
  });

  it('removing a nonexistent id is a no-op', () => {
    const { removeMediaItem } = useEditorStore.getState();
    expect(() => removeMediaItem('does-not-exist')).not.toThrow();
    expect(useEditorStore.getState().mediaLibrary).toHaveLength(0);
  });
});
