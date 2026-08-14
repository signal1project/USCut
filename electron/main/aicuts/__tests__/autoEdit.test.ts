import { describe, it, expect, vi } from 'vitest';
import type { AIProvider } from '@mas/types';
import {
  autoEdit,
  generateCaptionsFromTranscript,
  detectPlatform,
} from '../autoEdit';
import type { TimelineClip } from '../ffmpegOps';

function fakeProvider(response: string): AIProvider {
  return {
    name: 'claude',
    generateText: vi.fn().mockResolvedValue(response),
    generateImage: vi.fn(),
  };
}

describe('autoEdit', () => {
  it('sends clips/instruction to the injected provider and parses its JSON', async () => {
    const provider = fakeProvider(
      JSON.stringify({
        decisions: [
          { clipId: 'a', trimStart: 0, trimEnd: 1, startTime: 0, reason: 'x' },
        ],
        summary: 'Trimmed clip a.',
      }),
    );

    const result = await autoEdit(
      {
        clips: [{ id: 'a', name: 'a.mp4', duration: 10, src: '/a.mp4' }],
        prompt: 'Make it punchy',
      },
      provider,
    );

    expect(provider.generateText).toHaveBeenCalledTimes(1);
    const [prompt, options] = (provider.generateText as any).mock.calls[0];
    expect(prompt).toContain('Make it punchy');
    expect(prompt).toContain('"id":"a"');
    expect(options).toMatchObject({ maxTokens: 1536 });
    expect(result.summary).toBe('Trimmed clip a.');
    expect(result.decisions).toHaveLength(1);
  });

  it('never touches a hardcoded SDK client — the provider is the only source of output', async () => {
    // Guards against regressing to a module-level `new Anthropic()` that reads
    // ANTHROPIC_API_KEY directly: if that ever gets reintroduced, this fake
    // provider's canned response wouldn't be what determines the result.
    const provider = fakeProvider(
      JSON.stringify({ decisions: [], summary: 'from the fake provider' }),
    );
    const result = await autoEdit({ clips: [], prompt: 'anything' }, provider);
    expect(result.summary).toBe('from the fake provider');
  });

  it('falls back to original clip order when the provider returns invalid JSON', async () => {
    const provider = fakeProvider('not json');
    const result = await autoEdit(
      {
        clips: [
          { id: 'a', name: 'a.mp4', duration: 5, src: '/a.mp4' },
          { id: 'b', name: 'b.mp4', duration: 3, src: '/b.mp4' },
        ],
        prompt: 'edit it',
      },
      provider,
    );
    expect(result.summary).toContain('fallback');
    expect(result.decisions.map((d) => d.clipId)).toEqual(['a', 'b']);
    expect(result.decisions[1].startTime).toBe(5);
  });

  it('grounds the prompt in the real transcript when one is provided', async () => {
    const provider = fakeProvider(
      JSON.stringify({ decisions: [], summary: 'used transcript' }),
    );
    await autoEdit(
      {
        clips: [{ id: 'a', name: 'a.mp4', duration: 20, src: '/a.mp4' }],
        prompt: 'make this a facebook reel',
        transcripts: {
          a: [
            { start: 4.2, end: 6.8, text: "Here's the mistake everyone makes" },
          ],
        },
      },
      provider,
    );
    const [prompt] = (provider.generateText as any).mock.calls[0];
    expect(prompt).toContain("Here's the mistake everyone makes");
    expect(prompt).toContain('[4.2-6.8]');
  });

  it('injects the detected platform playbook and trending topics', async () => {
    const provider = fakeProvider(
      JSON.stringify({ decisions: [], summary: 'ok' }),
    );
    await autoEdit(
      {
        clips: [{ id: 'a', name: 'a.mp4', duration: 20, src: '/a.mp4' }],
        prompt: 'make this a facebook reel',
        trending: ['World Series', 'iPhone 18'],
      },
      provider,
    );
    const [prompt] = (provider.generateText as any).mock.calls[0];
    expect(prompt).toContain('FACEBOOK ALGORITHM GUIDANCE');
    expect(prompt).toContain('World Series');
  });

  it('tells the model plainly when no transcript is available', async () => {
    const provider = fakeProvider(
      JSON.stringify({ decisions: [], summary: 'ok' }),
    );
    await autoEdit(
      {
        clips: [{ id: 'a', name: 'a.mp4', duration: 20, src: '/a.mp4' }],
        prompt: 'edit it',
      },
      provider,
    );
    const [prompt] = (provider.generateText as any).mock.calls[0];
    expect(prompt).toContain('No transcript available');
  });
});

describe('detectPlatform', () => {
  it('matches common platform phrasing case-insensitively', () => {
    expect(detectPlatform('make this a Facebook reel')).toBe('facebook');
    expect(detectPlatform('post to TikTok')).toBe('tiktok');
    expect(detectPlatform('for my instagram story')).toBe('instagram');
    expect(detectPlatform('turn into youtube shorts')).toBe('youtube');
  });

  it('returns undefined when nothing matches', () => {
    expect(detectPlatform('make it punchy')).toBeUndefined();
  });
});

describe('generateCaptionsFromTranscript', () => {
  const clip: TimelineClip = {
    id: 'c1',
    src: '/c1.mp4',
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    duration: 8,
    type: 'video',
  };

  it('sends the transcript to the injected provider and parses segments', async () => {
    const provider = fakeProvider(
      JSON.stringify([{ startTime: 0, endTime: 2, text: 'Hello there' }]),
    );
    const segments = await generateCaptionsFromTranscript(
      'Hello there, welcome back.',
      [clip],
      provider,
    );
    expect(provider.generateText).toHaveBeenCalledTimes(1);
    const [prompt] = (provider.generateText as any).mock.calls[0];
    expect(prompt).toContain('Hello there, welcome back.');
    expect(segments).toEqual([
      { startTime: 0, endTime: 2, text: 'Hello there' },
    ]);
  });

  it('returns an empty array when the provider returns invalid JSON', async () => {
    const provider = fakeProvider('not json');
    const segments = await generateCaptionsFromTranscript(
      'transcript',
      [clip],
      provider,
    );
    expect(segments).toEqual([]);
  });
});
