import { describe, it, expect } from 'vitest';
import {
  parseSrtOrVtt,
  toSrt,
  toAss,
  parseWhisperCppJsonWords,
  type TranscriptSegment,
} from '../transcription';
import {
  scoreSegment,
  pickHighlightsHeuristic,
  pickHighlights,
  normalizeHeuristicScore,
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

describe('toAss', () => {
  const segNoWords: TranscriptSegment = {
    start: 0,
    end: 3,
    text: 'Hello world',
  };
  const segWithWords: TranscriptSegment = {
    start: 0,
    end: 2,
    text: 'Hello there world',
    words: [
      { start: 0, end: 0.5, text: 'Hello' },
      { start: 0.5, end: 1, text: 'there' },
      { start: 1, end: 2, text: 'world' },
    ],
  };

  it('emits a styled ASS header (fonts, bold, positioning)', () => {
    const ass = toAss([segNoWords]);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    // Style line: ...,Bold,Italic,Underline,StrikeOut,... — "-1" (bold=true) here.
    expect(ass).toMatch(/^Style: Default,Arial,\d+,&H\w+,&H\w+,&H\w+,&H\w+,-1,/m);
  });

  it('falls back to a static line when a segment has no word timing', () => {
    const ass = toAss([segNoWords]);
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Hello world');
    expect(ass).not.toContain('\\k');
  });

  it('renders per-word \\k karaoke tags when word timing is present', () => {
    const ass = toAss([segWithWords]);
    expect(ass).toContain('{\\k50}Hello');
    expect(ass).toContain('{\\k50}there');
    expect(ass).toContain('{\\k100}world');
  });

  it('applies the offset the same way toSrt does', () => {
    const ass = toAss([segWithWords], 0.5);
    expect(ass).toContain('0:00:00.00'); // start shifted from 0 by -0.5, clamped to 0
    expect(ass).toContain('0:00:01.50'); // end shifted from 2 by -0.5
  });

  it('escapes ASS-significant characters ({ } and newlines) in plain text', () => {
    const ass = toAss([{ start: 0, end: 1, text: 'weird {brace} text' }]);
    expect(ass).toContain('weird \\{brace\\} text');
  });
});

describe('parseWhisperCppJsonWords', () => {
  it('extracts word timing from whisper.cpp --output-json-full tokens', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          tokens: [
            { text: ' Hello', offsets: { from: 0, to: 500 } },
            { text: ' world', offsets: { from: 500, to: 1000 } },
          ],
        },
      ],
    });
    const words = parseWhisperCppJsonWords(raw);
    expect(words).toEqual([
      { start: 0, end: 0.5, text: 'Hello' },
      { start: 0.5, end: 1, text: 'world' },
    ]);
  });

  it('skips control tokens like [_BEG_]', () => {
    const raw = JSON.stringify({
      transcription: [
        {
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
            { text: ' Hi', offsets: { from: 0, to: 300 } },
          ],
        },
      ],
    });
    expect(parseWhisperCppJsonWords(raw)).toEqual([
      { start: 0, end: 0.3, text: 'Hi' },
    ]);
  });

  it('returns an empty array on malformed input instead of throwing', () => {
    expect(parseWhisperCppJsonWords('not json')).toEqual([]);
    expect(parseWhisperCppJsonWords('{}')).toEqual([]);
    expect(parseWhisperCppJsonWords('{"transcription":"nope"}')).toEqual([]);
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
    expect(wins[0].score).toBeGreaterThanOrEqual(0);
    expect(wins[0].score).toBeLessThanOrEqual(100);
  });

  it('normalizeHeuristicScore clamps to 0-100', () => {
    expect(normalizeHeuristicScore(0)).toBe(0);
    expect(normalizeHeuristicScore(10)).toBe(100);
    expect(normalizeHeuristicScore(-5)).toBe(0);
    expect(normalizeHeuristicScore(999)).toBe(100);
  });

  it('uses AI picks when the provider returns valid JSON', async () => {
    const provider = {
      name: 'mock',
      generateText: async () =>
        '[{"start": 4.5, "end": 20, "hook": "3 mistakes", "score": 92}]',
    } as unknown as AIProvider;
    const segs = parseSrtOrVtt(SRT);
    const { windows, pickedBy } = await pickHighlights(
      segs,
      { maxClips: 2, clipSeconds: 15 },
      provider,
    );
    expect(pickedBy).toBe('ai');
    expect(windows[0]).toMatchObject({ start: 4.5, end: 20, score: 92 });
  });

  it('defaults AI score to 70 when the provider omits it', async () => {
    const provider = {
      name: 'mock',
      generateText: async () =>
        '[{"start": 4.5, "end": 20, "hook": "3 mistakes"}]',
    } as unknown as AIProvider;
    const segs = parseSrtOrVtt(SRT);
    const { windows } = await pickHighlights(
      segs,
      { maxClips: 1, clipSeconds: 15 },
      provider,
    );
    expect(windows[0].score).toBe(70);
  });

  it('heuristic query filter boosts segments matching the query', () => {
    const withoutQuery = scoreSegment('Mistake number one is skipping pre-approval.');
    const withQuery = scoreSegment(
      'Mistake number one is skipping pre-approval.',
      'pre-approval mistakes',
    );
    expect(withQuery).toBeGreaterThan(withoutQuery);
  });

  it('AI prompt includes the query clause when a query is set', async () => {
    let capturedPrompt = '';
    const provider = {
      name: 'mock',
      generateText: async (prompt: string) => {
        capturedPrompt = prompt;
        return '[{"start": 4.5, "end": 20, "hook": "3 mistakes", "score": 80}]';
      },
    } as unknown as AIProvider;
    const segs = parseSrtOrVtt(SRT);
    await pickHighlights(
      segs,
      { maxClips: 1, clipSeconds: 15, query: 'find the funny moments' },
      provider,
    );
    expect(capturedPrompt).toContain('find the funny moments');
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
