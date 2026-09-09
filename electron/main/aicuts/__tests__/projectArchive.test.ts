import { describe, expect, it } from 'vitest';
import {
  collectMediaSources,
  remapProjectMedia,
} from '../../../../commont/projectArchive';
import type { ProjectFileV1 } from '../projects';

const project = (): ProjectFileV1 => ({
  version: 1,
  id: 'p1',
  name: 'Demo',
  savedAt: '2026-09-09T00:00:00Z',
  zoom: 40,
  tracks: [
    {
      id: 't-v',
      clips: [
        { id: 'c1', src: 'C:/media/a.mp4', previewSrc: 'C:/proxies/a.mp4' },
        { id: 'c2', src: 'C:/media/a.mp4' }, // same source twice
        { id: 'cap', src: '', captionText: 'Hi' },
      ],
    },
    { id: 't-a', clips: [{ id: 'c3', src: 'C:/media/music.m4a' }] },
  ],
  mediaLibrary: [
    { id: 'm1', src: 'C:/media/a.mp4', name: 'A' },
    { id: 'm2', src: 'C:/media/logo.png', name: 'Logo' },
  ],
});

describe('project archive media rewriting', () => {
  it('collects each distinct referenced media path once, ignoring caption clips', () => {
    expect(collectMediaSources(project()).sort()).toEqual([
      'C:/media/a.mp4',
      'C:/media/logo.png',
      'C:/media/music.m4a',
    ]);
  });

  it('remaps every src through the map and drops now-stale previewSrc', () => {
    const mapped = remapProjectMedia(project(), (src) =>
      src === 'C:/media/a.mp4' ? 'media/a.mp4' : undefined,
    );
    const clips = (mapped.tracks[0] as { clips: Record<string, unknown>[] })
      .clips;
    expect(clips[0].src).toBe('media/a.mp4');
    expect('previewSrc' in clips[0]).toBe(false); // dropped — src changed
    expect(clips[2].src).toBe(''); // caption untouched
    expect(
      (mapped.tracks[1] as { clips: { src: string }[] }).clips[0].src,
    ).toBe('C:/media/music.m4a'); // no mapping -> unchanged
    expect(mapped.mediaLibrary[0].src).toBe('media/a.mp4');
    expect(mapped.mediaLibrary[1].src).toBe('C:/media/logo.png');
  });

  it('leaves the original project object untouched', () => {
    const original = project();
    remapProjectMedia(original, () => 'media/x');
    expect(
      (original.tracks[0] as { clips: { src: string }[] }).clips[0].src,
    ).toBe('C:/media/a.mp4');
  });
});
