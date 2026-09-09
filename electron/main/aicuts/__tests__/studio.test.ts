import { describe, expect, it } from 'vitest';
import {
  assembleStudioProject,
  validateStudioDraft,
  studioTimelineDuration,
  buildStoryboardPrompt,
  parseStoryboardScenes,
  buildRevisionPrompt,
  applySceneRevision,
  type StudioDraft,
} from '../../../../commont/studio';

const draft: StudioDraft = {
  title: 'Launch',
  brief: 'A short introduction',
  music: null,
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

describe('Studio storyboard prompt grounding', () => {
  const input = {
    title: 'Launch',
    brief: 'Sell the loft',
    assets: draft.assets,
  };
  it('states media was not analysed when there are no frame insights', () => {
    const prompt = buildStoryboardPrompt(input, []);
    expect(prompt).toContain('NOT been visually analysed');
    expect(prompt).not.toContain('"visual"');
  });
  it('injects each per-asset visual description and switches the guidance line', () => {
    const prompt = buildStoryboardPrompt(input, [
      { assetId: 'v', description: 'A sunlit kitchen with marble counters.' },
    ]);
    expect(prompt).toContain('automated frame analysis actually saw');
    expect(prompt).toContain('A sunlit kitchen with marble counters.');
    expect(prompt).toContain('"visual"');
    // Assets without an insight are not given a fabricated one.
    expect(prompt).not.toMatch(/"id":"i"[^}]*"visual"/);
  });
  it('parseStoryboardScenes strips code fences and requires a scenes array', () => {
    expect(
      parseStoryboardScenes('```json\n{"scenes":[{"assetId":"v"}]}\n```'),
    ).toEqual([{ assetId: 'v' }]);
    expect(() => parseStoryboardScenes('{"nope":1}')).toThrow('scenes array');
  });
});

describe('Studio single-scene revision', () => {
  it('builds a prompt scoped to one scene with its footage description', () => {
    const prompt = buildRevisionPrompt(
      draft,
      { sceneIndex: 0, instruction: 'punchier headline' },
      [{ assetId: 'v', description: 'Drone shot of the block.' }],
    );
    expect(prompt).toContain('punchier headline');
    expect(prompt).toContain('Drone shot of the block.');
    expect(prompt).toContain('"currentScene"');
  });
  it('replaces only the target scene and re-validates the whole draft', () => {
    const revised = applySceneRevision(draft, 0, {
      assetId: 'v',
      sourceStart: 0,
      duration: 6,
      headline: 'Now leasing',
      narration: '',
    });
    expect(revised.scenes[0]).toMatchObject({
      duration: 6,
      headline: 'Now leasing',
    });
    expect(revised.scenes[1]).toEqual(draft.scenes[1]);
  });
  it('rejects a revised scene that overruns its source video', () => {
    expect(() =>
      applySceneRevision(draft, 0, {
        assetId: 'v',
        sourceStart: 10,
        duration: 8,
        headline: '',
        narration: '',
      }),
    ).toThrow();
  });
  it('rejects an out-of-range scene index', () => {
    expect(() =>
      applySceneRevision(draft, 9, {
        assetId: 'v',
        sourceStart: 0,
        duration: 3,
        headline: '',
        narration: '',
      }),
    ).toThrow('no longer exists');
  });
});

describe('Studio music bed', () => {
  it('measures the timeline including narration that extends a scene', () => {
    expect(studioTimelineDuration(draft)).toBe(7); // 4 + 3
    expect(
      studioTimelineDuration(draft, { 0: { src: 'v.wav', duration: 9 } }),
    ).toBe(12); // 9 + 3
  });
  it('adds a single music track trimmed to the timeline with a tail fade', () => {
    const project = assembleStudioProject(
      draft,
      'p',
      {},
      {
        src: '/beds/bed.m4a',
        name: 'Calm bed',
        volume: 0.2,
        duration: 30,
      },
    );
    const music = project.tracks.find((t) => t.label === 'Music')!;
    expect(music.clips).toHaveLength(1);
    expect(music.clips[0]).toMatchObject({
      startTime: 0,
      volume: 0.2,
      trimEnd: 23, // 30 - 7s timeline
      fadeOut: 2,
    });
    expect(project.mediaLibrary.some((m) => m.src === '/beds/bed.m4a')).toBe(
      true,
    );
  });
  it('has no music track when none is chosen and rejects a bad bed duration', () => {
    expect(
      assembleStudioProject(draft, 'p').tracks.some((t) => t.label === 'Music'),
    ).toBe(false);
    expect(() =>
      assembleStudioProject(
        draft,
        'p',
        {},
        {
          src: '/b.m4a',
          name: 'x',
          volume: 0.2,
          duration: 0,
        },
      ),
    ).toThrow('music bed duration');
  });
});
