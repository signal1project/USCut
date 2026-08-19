import { describe, it, expect } from 'vitest';
import {
  ASPECT_DIMENSIONS,
  buildAssSubtitles,
  buildExportGraph,
  compressTime,
  planBaseSegments,
  atempoChain,
  adjustFilter,
  type GraphClip,
} from '../exportGraph';

function clip(partial: Partial<GraphClip>): GraphClip {
  return {
    id: partial.id ?? 'c1',
    src: partial.src ?? 'C:/v/a.mp4',
    type: partial.type ?? 'video',
    trackIndex: partial.trackIndex ?? 0,
    startTime: partial.startTime ?? 0,
    trimStart: partial.trimStart ?? 0,
    trimEnd: partial.trimEnd ?? 0,
    duration: partial.duration ?? 10,
    ...partial,
  };
}

const OPTS = {
  width: 1080,
  height: 1920,
  fps: 30,
  hasAudioBySrc: { 'C:/v/a.mp4': true, 'C:/v/b.mp4': true, 'C:/a/m.mp3': true },
};

describe('planBaseSegments', () => {
  it('inserts black gap segments for timeline holes', () => {
    const segs = planBaseSegments([
      clip({ id: 'a', startTime: 0, duration: 4 }),
      clip({ id: 'b', startTime: 6, duration: 4 }),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(['clip', 'gap', 'clip']);
    expect(segs[1].duration).toBeCloseTo(2);
    expect(segs[2].timelineStart).toBeCloseTo(6);
  });

  it('extends the tail with black when music outlasts video', () => {
    const segs = planBaseSegments([clip({ duration: 4 })], 10);
    expect(segs[segs.length - 1]).toMatchObject({ kind: 'gap' });
    expect(segs[segs.length - 1].duration).toBeCloseTo(6);
  });

  it('clamps overlapping base clips', () => {
    const segs = planBaseSegments([
      clip({ id: 'a', startTime: 0, duration: 5 }),
      clip({ id: 'b', startTime: 3, duration: 5 }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[1].timelineStart).toBeCloseTo(5);
  });

  it('accounts for speed in effective duration', () => {
    const segs = planBaseSegments([clip({ duration: 10, speed: 2 })]);
    expect(segs[0].duration).toBeCloseTo(5);
  });
});

describe('compressTime', () => {
  it('shifts times after each transition', () => {
    const transitions = [
      { at: 5, duration: 1 },
      { at: 10, duration: 0.5 },
    ];
    expect(compressTime(3, transitions)).toBeCloseTo(3);
    expect(compressTime(7, transitions)).toBeCloseTo(6);
    expect(compressTime(12, transitions)).toBeCloseTo(10.5);
  });
});

describe('buildExportGraph', () => {
  it('throws on an empty timeline', () => {
    expect(() => buildExportGraph([], OPTS)).toThrow(/empty/i);
  });

  it('builds video+audio chains with gap silence and music mix', () => {
    const graph = buildExportGraph(
      [
        clip({ id: 'v1', startTime: 0, duration: 4 }),
        clip({ id: 'v2', startTime: 6, duration: 4, src: 'C:/v/b.mp4' }),
        clip({
          id: 'm1',
          type: 'audio',
          src: 'C:/a/m.mp3',
          startTime: 2,
          duration: 5,
        }),
      ],
      OPTS,
    );
    const all = graph.filters.join(';');
    // gap → color source + silence
    expect(all).toContain('color=c=black:s=1080x1920');
    expect(all).toContain('anullsrc');
    // music positioned via adelay at 2000ms
    expect(all).toContain('adelay=2000:all=1');
    // final mix includes music bus
    expect(all).toContain('amix=inputs=2');
    expect(graph.durationSeconds).toBeCloseTo(10);
    expect(graph.inputs).toHaveLength(3);
  });

  it('applies per-clip volume and fades to audio', () => {
    const graph = buildExportGraph(
      [clip({ duration: 6, volume: 0.4, fadeIn: 0.5, fadeOut: 1 })],
      OPTS,
    );
    const all = graph.filters.join(';');
    expect(all).toContain('volume=0.400');
    expect(all).toContain('afade=t=in:st=0:d=0.500');
    expect(all).toContain('afade=t=out:st=5.000:d=1.000');
  });

  it('generates silence for muted or soundless clips', () => {
    const graph = buildExportGraph(
      [clip({ duration: 4, src: 'C:/v/silent.mp4' })],
      { ...OPTS, hasAudioBySrc: { 'C:/v/silent.mp4': false } },
    );
    expect(graph.filters.join(';')).toContain('anullsrc');
  });

  it('wires xfade + acrossfade for transitions and compresses duration', () => {
    const graph = buildExportGraph(
      [
        clip({ id: 'a', startTime: 0, duration: 5 }),
        clip({
          id: 'b',
          startTime: 5,
          duration: 5,
          src: 'C:/v/b.mp4',
          transitionIn: { type: 'wipeleft', duration: 1 },
        }),
      ],
      OPTS,
    );
    const all = graph.filters.join(';');
    expect(all).toContain(
      'xfade=transition=wipeleft:duration=1.000:offset=4.000',
    );
    expect(all).toContain('acrossfade=d=1.000');
    expect(graph.durationSeconds).toBeCloseTo(9);
    expect(graph.transitions).toHaveLength(1);
  });

  it('overlays clips from video tracks 1+ with position and enable window', () => {
    const graph = buildExportGraph(
      [
        clip({ id: 'base', duration: 10 }),
        clip({
          id: 'logo',
          type: 'image',
          src: 'C:/img/logo.png',
          trackIndex: 1,
          startTime: 2,
          duration: 5,
          overlay: { x: 0.5, y: 0.1, scale: 0.25, opacity: 0.8 },
        }),
      ],
      OPTS,
    );
    const all = graph.filters.join(';');
    expect(all).toContain("overlay=540:192:enable='between(t,2.000,7.000)'");
    expect(all).toContain('colorchannelmixer=aa=0.800');
    // image input looped for its duration
    expect(graph.inputs[1].options).toContain('-loop');
  });

  it('adds sidechain ducking when duckMusic is on', () => {
    const graph = buildExportGraph(
      [
        clip({ duration: 6 }),
        clip({
          id: 'm',
          type: 'audio',
          src: 'C:/a/m.mp3',
          startTime: 0,
          duration: 6,
        }),
      ],
      { ...OPTS, duckMusic: true },
    );
    expect(graph.filters.join(';')).toContain('sidechaincompress');
  });
});

describe('helpers', () => {
  it('atempoChain decomposes extreme speeds', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(['atempo=2.0', 'atempo=2.0']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
  });

  it('adjustFilter maps presets to eq chains', () => {
    expect(adjustFilter({ preset: 'mono' }).join(',')).toContain(
      'saturation=0.000',
    );
    expect(adjustFilter({ preset: 'warm' }).join(',')).toContain(
      'colortemperature',
    );
    expect(adjustFilter(undefined)).toEqual([]);
  });

  it('aspect table covers all combinations', () => {
    expect(ASPECT_DIMENSIONS['9:16']['1080p']).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(ASPECT_DIMENSIONS['4:5']['720p']).toEqual({
      width: 720,
      height: 900,
    });
  });
});

describe('buildAssSubtitles', () => {
  it('emits styles and compressed dialogue times', () => {
    const ass = buildAssSubtitles(
      [
        clip({
          id: 'cap',
          type: 'caption',
          startTime: 6,
          duration: 3,
          captionText: 'Hello\nWorld',
          captionStyle: {
            fontSize: 60,
            color: '#ff0000',
            position: 'top',
            background: true,
          },
        }),
      ],
      { width: 1080, height: 1920, transitions: [{ at: 5, duration: 1 }] },
    );
    expect(ass).toContain('PlayResX: 1080');
    // 6s start compressed to 5s by the 1s transition at t=5
    expect(ass).toContain('Dialogue: 0,0:00:05.00');
    expect(ass).toContain('\\N'); // newline escaped
    expect(ass).toContain('&H000000FF'.slice(0, 4)); // ASS color format present
    // fontsize scaled to 1920-height output (60 * 1920/1080 ≈ 107)
    expect(ass).toMatch(/Style: S0,Arial,107/);
    // top alignment = 8
    expect(ass).toMatch(/,8,40,40,40,1$/m);
  });

  it('declares the same number of [Events] fields in Format as Dialogue lines actually emit', () => {
    // Regression test: the Format line previously omitted the standard
    // "Name" field while Dialogue lines already emitted 10 comma-separated
    // leading fields, so libass absorbed the unused 10th field (and its
    // separating comma) into the start of the rendered Text — every caption
    // in the app rendered with a stray leading comma (caught via an actual
    // rendered frame, not just string assertions on the .ass content).
    const ass = buildAssSubtitles(
      [
        clip({
          id: 'cap',
          type: 'caption',
          startTime: 0,
          duration: 3,
          captionText: 'Kitchen',
        }),
      ],
      { width: 1080, height: 1920, transitions: [] },
    );
    const formatLine = ass
      .split('\n')
      .find((l) => l.startsWith('Format:') && l.includes('Layer'))!;
    const dialogueLine = ass
      .split('\n')
      .find((l) => l.startsWith('Dialogue:'))!;
    expect(formatLine).toContain('Name');
    // Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect are the
    // first 9 comma-separated fields; Text is everything after (rejoined,
    // since Text may itself legitimately contain commas). Before the fix,
    // Format was missing "Name", so a libass-style 9-field parse would
    // have left Text as ",Kitchen" instead of "Kitchen".
    const fields = dialogueLine.slice('Dialogue: '.length).split(',');
    const text = fields.slice(9).join(',');
    expect(text).toBe('Kitchen');
  });
});

describe('bucketPeaks', () => {
  it('buckets absolute peaks into 0..1', async () => {
    const { bucketPeaks } = await import('../audioTools');
    const samples = new Int16Array([0, 16384, -32768, 100, 0, 0, 8192, -16384]);
    const peaks = bucketPeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.5, 1);
    expect(peaks[1]).toBeCloseTo(1, 2);
    expect(peaks[3]).toBeCloseTo(0.5, 1);
  });

  it('handles empty input', async () => {
    const { bucketPeaks } = await import('../audioTools');
    expect(bucketPeaks(new Int16Array(0), 10)).toEqual([]);
  });
});
