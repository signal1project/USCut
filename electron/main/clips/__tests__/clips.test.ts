import { describe, it, expect } from 'vitest';
import { parseSrtOrVtt, toSrt } from '../transcription';
import {
  scoreSegment,
  pickHighlightsHeuristic,
  pickHighlights,
} from '../autoClip';
import type { AIProvider } from '@mas/types';

const SRT = `1
00:00:00,000 --> 00:00:04,500
Welcome to the channel everyone.

2
00:00:04,500 --> 00:00:12,000
Here are 3 mistakes first-time homebuyers always make!

3
00:00:12,000 --> 00:00:20,000
Mistake number one is skipping pre-approval.

4
00:00:20,000 --> 00:00:30,000
And that wraps up today's video, thanks for watching.
`;

describe('parseSrtOrVtt', () => {
  it('parses SRT blocks with timestamps', () => {
    const segs = parseSrtOrVtt(SRT);
    expect(segs).toHaveLength(4);
    expect(segs[0]).toMatchObject({ start: 0, end: 4.5 });
    expect(segs[1].text).toContain('3 mistakes');
  });

  it('parses WebVTT with dot-millis', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello there.`;
    const segs = parseSrtOrVtt(vtt);
    expect(segs).toHaveLength(1);
    expect(segs[0].start).toBe(1);
  });

  it('round-trips through toSrt with an offset', () => {
    const segs = parseSrtOrVtt(SRT);
    const srt = toSrt(segs.slice(1, 3), 4.5);
    expect(srt).toContain('00:00:00,000');
    expect(srt).toContain('3 mistakes');
  });
});

describe('highlight picking', () => {
  it('scores hook-y segments higher', () => {
    expect(
      scoreSegment('Here are 3 mistakes you should never make!'),
    ).toBeGreaterThan(scoreSegment('And that wraps up the video.'));
  });

  it('heuristic picks non-overlapping windows around the best segments', () => {
    const segs = parseSrtOrVtt(SRT);
    const wins = pickHighlightsHeuristic(segs, {
      maxClips: 2,
      clipSeconds: 10,
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i].start).toBeGreaterThanOrEqual(wins[i - 1].end);
    }
    expect(wins[0].hook.length).toBeGreaterThan(0);
  });

  it('uses AI picks when the provider returns valid JSON', async () => {
    const provider = {
      name: 'mock',
      generateText: async () =>
        '[{"start": 4.5, "end": 20, "hook": "3 mistakes"}]',
    } as unknown as AIProvider;
    const segs = parseSrtOrVtt(SRT);
    const { windows, pickedBy } = await pickHighlights(
      segs,
      { maxClips: 2, clipSeconds: 15 },
      provider,
    );
    expect(pickedBy).toBe('ai');
    expect(windows[0]).toMatchObject({ start: 4.5, end: 20 });
  });

  it('falls back to heuristic on provider garbage', async () => {
    const provider = {
      name: 'mock',
      generateText: async () => 'sorry, I cannot help with that',
    } as unknown as AIProvider;
    const segs = parseSrtOrVtt(SRT);
    const { pickedBy, windows } = await pickHighlights(
      segs,
      { maxClips: 1, clipSeconds: 10 },
      provider,
    );
    expect(pickedBy).toBe('heuristic');
    expect(windows.length).toBe(1);
  });
});
