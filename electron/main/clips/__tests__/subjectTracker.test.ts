import { describe, it, expect, vi } from 'vitest';
import type { AIProvider } from '@mas/types';
import { trackSubject } from '../subjectTracker';

vi.mock('../frameSampler', () => ({
  sampleFrames: vi.fn(async () => [
    { timestampSeconds: 10, base64Jpeg: 'AAA' },
    { timestampSeconds: 11, base64Jpeg: 'BBB' },
  ]),
}));

describe('trackSubject', () => {
  it('returns null when the provider has no analyzeFrames capability', async () => {
    const provider = { name: 'mock', generateText: async () => '' } as unknown as AIProvider;
    const result = await trackSubject('video.mp4', { start: 10, end: 20 }, provider);
    expect(result).toBeNull();
  });

  it('returns null when no provider is given', async () => {
    expect(await trackSubject('video.mp4', { start: 10, end: 20 }, null)).toBeNull();
  });

  it('parses provider output into TrackPoints relative to the window start', async () => {
    const provider = {
      name: 'mock',
      generateText: async () => '',
      analyzeFrames: async () =>
        '{"points": [{"t": 0, "cx": 0.3, "cy": 0.4}, {"t": 1, "cx": 0.6, "cy": 0.5}]}',
    } as unknown as AIProvider;
    const result = await trackSubject('video.mp4', { start: 10, end: 20 }, provider);
    expect(result).toEqual([
      { t: 0, cx: 0.3, cy: 0.4 },
      { t: 1, cx: 0.6, cy: 0.5 },
    ]);
  });

  it('clamps out-of-range cx/cy and drops non-finite entries', async () => {
    const provider = {
      name: 'mock',
      generateText: async () => '',
      analyzeFrames: async () =>
        '{"points": [{"t": 0, "cx": 1.5, "cy": -0.5}, {"t": 1, "cx": "nope", "cy": 0.5}]}',
    } as unknown as AIProvider;
    const result = await trackSubject('video.mp4', { start: 0, end: 10 }, provider);
    expect(result).toEqual([{ t: 0, cx: 1, cy: 0 }]);
  });

  it('returns null when the provider response has no parseable JSON', async () => {
    const provider = {
      name: 'mock',
      generateText: async () => '',
      analyzeFrames: async () => 'sorry, I cannot help with that',
    } as unknown as AIProvider;
    const result = await trackSubject('video.mp4', { start: 0, end: 10 }, provider);
    expect(result).toBeNull();
  });

  it('returns null (never throws) when analyzeFrames itself rejects', async () => {
    const provider = {
      name: 'mock',
      generateText: async () => '',
      analyzeFrames: async () => {
        throw new Error('boom');
      },
    } as unknown as AIProvider;
    const result = await trackSubject('video.mp4', { start: 0, end: 10 }, provider);
    expect(result).toBeNull();
  });
});
