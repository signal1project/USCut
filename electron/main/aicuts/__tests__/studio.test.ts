import { describe, expect, it } from 'vitest';
import {
  assembleStudioProject,
  validateStudioDraft,
  type StudioDraft,
} from '../../../../commont/studio';

const draft: StudioDraft = {
  title: 'Launch',
  brief: 'A short introduction',
  assets: [
    { id: 'v', src: 'video.mp4', name: 'Video', type: 'video', duration: 12 },
    { id: 'i', src: 'image.png', name: 'Image', type: 'image', duration: 5 },
  ],
  scenes: [
    {
      assetId: 'v',
      sourceStart: 2,
      duration: 4,
      headline: 'Hello',
      narration: '',
    },
    {
      assetId: 'i',
      sourceStart: 0,
      duration: 3,
      headline: 'Learn more',
      narration: 'Visit us',
    },
  ],
};
describe('Production Studio assembly', () => {
  it('preserves source timing and produces editable separate tracks', () => {
    const project = assembleStudioProject(draft, 'p');
    const clips = project.tracks[0].clips;
    expect(clips[0]).toMatchObject({
      duration: 12,
      trimStart: 2,
      trimEnd: 6,
      startTime: 0,
    });
    expect(clips[1]).toMatchObject({
      duration: 3,
      trimStart: 0,
      trimEnd: 0,
      startTime: 4,
    });
    expect(project.tracks[1].clips.map((c) => c.startTime)).toEqual([0, 4]);
    expect(project.tracks[2].clips).toHaveLength(0);
    expect(draft.scenes[0].duration).toBe(4);
  });
  it('extends an image for narration and retains generated audio in media library', () => {
    const project = assembleStudioProject(draft, 'p', {
      1: { src: 'voice.wav', duration: 7 },
    });
    expect(project.tracks[0].clips[1]).toMatchObject({
      duration: 7,
      volume: 0,
    });
    expect(project.tracks[1].clips[1].duration).toBe(7);
    expect(project.tracks[2].clips[0]).toMatchObject({
      startTime: 4,
      duration: 7,
    });
    expect(project.mediaLibrary).toHaveLength(3);
  });
  it('refuses narration that exceeds available video instead of freezing or truncating silently', () => {
    expect(() =>
      assembleStudioProject(draft, 'p', {
        0: { src: 'voice.wav', duration: 11 },
      }),
    ).toThrow('Narration is longer');
  });
  it.each([
    { ...draft, scenes: [{ ...draft.scenes[0], assetId: 'invented' }] },
    { ...draft, scenes: [{ ...draft.scenes[0], duration: 11 }] },
    { ...draft, scenes: [{ ...draft.scenes[0], duration: NaN }] },
    { ...draft, scenes: [{ ...draft.scenes[0], sourceStart: -1 }] },
    { ...draft, assets: [draft.assets[0], draft.assets[0]] },
    { ...draft, scenes: [] },
  ])('rejects invalid or hallucinated storyboard data', (value) => {
    expect(() => validateStudioDraft(value)).toThrow();
  });
});
